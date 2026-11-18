import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { emsPool } from '@/lib/ems-db';
import { ApiError, asyncHandler } from '@/lib/http';
import { requireAdmin, type AuthenticatedRequest } from '@/lib/current-user';
import { hashPassword } from '@/lib/password';
import { logger } from '@/lib/logger';
import type { Role } from '@/generated/prisma';

export const adminEmployeesRouter = Router();

export interface EnrichedEmployee {
  id: number;
  orgId: number;
  orgName: string;
  orgCode: string;
  empCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string | null;
  gender: string | null;
  status: string;
  employmentType: string;
  dateOfJoining: string | null;
  officeLocation: string | null;
  baseSalary: string | null;
  departmentName: string;
  designationTitle: string;
  managerName: string | null;
  createdAt: string;
  authLinked: boolean;
  authUserId?: string;
  authRole?: Role;
  authStatus?: string;
}

export interface CompanyInfo {
  id: number;
  name: string;
  code: string;
  count: number;
}

// GET /api/admin/employees - List and filter corporate employees by company / department
adminEmployeesRouter.get(
  '/employees',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    // Defaults to 'SKYup Auth' so that only SkyUp Auth employees show by default
    const companyFilter = typeof req.query.company === 'string' ? req.query.company.trim() : 'SKYup Auth';
    const departmentFilter = typeof req.query.department === 'string' ? req.query.department.trim() : 'ALL';
    const officeFilter = typeof req.query.office === 'string' ? req.query.office.trim() : 'ALL';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : 'all';
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

    let rawEmployees: any[] = [];
    let isEmsAvailable = true;

    // First attempt: Query EMS Integration API directly using the SKYup Auth scoped key
    const emsApiUrl = process.env.EMS_INTEGRATION_URL || 'http://localhost:4005/api/integration/companies/SKA/employees';
    const emsApiKey = process.env.EMS_API_KEY || 'ems_5e03df05_BotH3RUsiebHG1RnfYjcONRRzCemMrgM1Cdfy2YWTE8';

    try {
      const response = await fetch(emsApiUrl, {
        headers: {
          'x-api-key': emsApiKey,
          'Authorization': `Bearer ${emsApiKey}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        const payload: any = await response.json();
        const list = Array.isArray(payload) ? payload : (payload?.employees || payload?.data || []);
        if (Array.isArray(list) && list.length > 0) {
          rawEmployees = list.map((item: any) => ({
            id: item.id,
            org_id: 3,
            org_name: item.company || 'SKYup Auth',
            org_code: item.company_code || 'SKA',
            emp_code: item.emp_code,
            first_name: item.first_name || (item.name ? item.name.split(' ')[0] : 'Staff'),
            last_name: item.last_name || (item.name && item.name.includes(' ') ? item.name.split(' ').slice(1).join(' ') : ''),
            email: item.login_email || item.email,
            phone: item.phone || null,
            gender: null,
            status: item.status || 'active',
            employment_type: 'full_time',
            date_of_joining: item.date_of_joining || null,
            office_location: item.office_location || item.officeLocation || 'Ahmedabad Commercial & Industrial Bureau',
            base_salary: null,
            created_at: new Date().toISOString(),
            department_name: item.department || 'Skyup Authcation',
            designation_title: item.designation || 'Staff Member',
            manager_first_name: item.manager_name ? item.manager_name.split(' ')[0] : (item.manager?.name ? item.manager.name.split(' ')[0] : null),
            manager_last_name: item.manager_name && item.manager_name.includes(' ') ? item.manager_name.split(' ').slice(1).join(' ') : null,
          }));
        }
      }
    } catch (apiErr: any) {
      logger.info('EMS Integration API fetch skipped or errored; falling back to scoped database query', {
        error: apiErr.message,
      });
    }

    if (rawEmployees.length === 0) {
      try {
        const emsResult = await emsPool.query(`
          SELECT 
            e.id, 
            COALESCE(e.org_id, 3) as org_id,
            COALESCE(o.name, 'SKYup Auth') as org_name,
            COALESCE(o.code, 'SKA') as org_code,
            e.emp_code, 
            e.first_name, 
            e.last_name, 
            e.email, 
            e.phone, 
            e.gender, 
            e.status, 
            e.employment_type, 
            e.date_of_joining, 
            e.office_location, 
            e.base_salary,
            e.created_at,
            COALESCE(d.name, 'General Staff') as department_name, 
            COALESCE(des.title, 'Staff Member') as designation_title,
            m.first_name as manager_first_name,
            m.last_name as manager_last_name
          FROM employees e
          LEFT JOIN organisations o ON e.org_id = o.id
          LEFT JOIN departments d ON e.department_id = d.id
          LEFT JOIN designations des ON e.designation_id = des.id
          LEFT JOIN employees m ON e.manager_id = m.id
          WHERE (e.org_id = 3 OR lower(o.code) = 'ska' OR lower(o.name) LIKE '%auth%')
          ORDER BY e.id DESC
        `);
        rawEmployees = emsResult.rows;
      } catch (err: any) {
        logger.warn('Failed to query EMS database directly; falling back to internal staff accounts', {
          error: err.message,
        });
        isEmsAvailable = false;
      }
    }

    // Collect all emails to cross-reference with skyup_auth Users table
    const employeeEmails = rawEmployees.map((e) => (e.email || '').toLowerCase()).filter(Boolean);

    const authUsers = await prisma.user.findMany({
      where: employeeEmails.length > 0 ? { email: { in: employeeEmails, mode: 'insensitive' } } : {},
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        displayName: true,
        officeLocation: true,
      },
    });

    const authMap = new Map<string, (typeof authUsers)[0]>();
    authUsers.forEach((u) => {
      if (u.email) {
        authMap.set(u.email.toLowerCase(), u);
      }
    });

    // If EMS had zero rows or was unavailable, fallback to Staff/Admin users in skyup_auth
    if (rawEmployees.length === 0) {
      const staffUsers = await prisma.user.findMany({
        where: {
          OR: [{ role: 'ADMIN' }, { role: 'EDITOR' }, { officeLocation: { not: null } }],
        },
        orderBy: { createdAt: 'desc' },
      });

      rawEmployees = staffUsers.map((u, idx) => ({
        id: 1000 + idx,
        org_id: 3,
        org_name: 'SKYup Auth',
        org_code: 'SKA',
        emp_code: `STAFF${String(idx + 1).padStart(3, '0')}`,
        first_name: u.displayName ? u.displayName.split(' ')[0] : 'Staff',
        last_name: u.displayName && u.displayName.includes(' ') ? u.displayName.split(' ').slice(1).join(' ') : 'Member',
        email: u.email || `staff${idx + 1}@skyupnews.com`,
        phone: u.phone || null,
        gender: null,
        status: u.status.toLowerCase(),
        employment_type: 'full_time',
        date_of_joining: u.createdAt.toISOString(),
        office_location: u.officeLocation || 'Headquarters',
        base_salary: null,
        created_at: u.createdAt.toISOString(),
        department_name: u.role === 'ADMIN' ? 'Executive Administration' : 'Editorial & Content',
        designation_title: u.role === 'ADMIN' ? 'Administrator' : 'Editor / Reporter',
        manager_first_name: null,
        manager_last_name: null,
      }));
    }

    // Transform and enrich employee records
    const allEnrichedList: EnrichedEmployee[] = rawEmployees.map((row) => {
      const email = (row.email || '').toLowerCase();
      const authUser = authMap.get(email);
      const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unnamed Staff';
      const managerName = [row.manager_first_name, row.manager_last_name].filter(Boolean).join(' ') || null;

      return {
        id: Number(row.id),
        orgId: Number(row.org_id || 1),
        orgName: row.org_name || 'SKYup News',
        orgCode: row.org_code || 'SKYUP',
        empCode: row.emp_code || `EMP${row.id}`,
        firstName: row.first_name || '',
        lastName: row.last_name || '',
        fullName,
        email: row.email || '',
        phone: row.phone || null,
        gender: row.gender || null,
        status: (row.status || 'active').toLowerCase(),
        employmentType: (row.employment_type || 'full_time').toLowerCase(),
        dateOfJoining: row.date_of_joining ? new Date(row.date_of_joining).toISOString() : null,
        officeLocation: row.office_location || 'Not Specified',
        baseSalary: row.base_salary ? String(row.base_salary) : null,
        departmentName: row.department_name || 'General Staff',
        designationTitle: row.designation_title || 'Staff Member',
        managerName,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        authLinked: Boolean(authUser),
        authUserId: authUser?.id,
        authRole: authUser?.role,
        authStatus: authUser?.status,
      };
    });

    // Enforce strict workspace isolation: In SkyUp Auth, only SKYup Auth (orgId 3, code SKA) employees are valid
    const scopedList = allEnrichedList.filter(
      (e) =>
        e.orgId === 3 ||
        e.orgCode.toUpperCase() === 'SKA' ||
        e.orgName.toLowerCase().includes('auth')
    );

    // Provide single pinned company scope for SKYup Auth
    const companies: CompanyInfo[] = [
      {
        id: 3,
        name: 'SKYup Auth',
        code: 'SKA',
        count: scopedList.length,
      },
    ];

    // Departments and offices scoped to current company
    const departments = Array.from(new Set(scopedList.map((e) => e.departmentName))).filter(Boolean).sort();
    const offices = Array.from(new Set(scopedList.map((e) => e.officeLocation))).filter(Boolean).sort();

    // Summary calculations (for the active company scope)
    const totalEmployees = scopedList.length;
    const activeEmployees = scopedList.filter((e) => e.status === 'active').length;
    const authLinkedCount = scopedList.filter((e) => e.authLinked).length;
    const departmentBreakdown: Record<string, number> = {};
    scopedList.forEach((e) => {
      departmentBreakdown[e.departmentName] = (departmentBreakdown[e.departmentName] || 0) + 1;
    });

    // Apply User Search & Secondary Filters
    let filteredList = scopedList;

    if (query) {
      filteredList = filteredList.filter((e) => {
        return (
          e.fullName.toLowerCase().includes(query) ||
          e.email.toLowerCase().includes(query) ||
          e.empCode.toLowerCase().includes(query) ||
          e.departmentName.toLowerCase().includes(query) ||
          e.designationTitle.toLowerCase().includes(query) ||
          (e.officeLocation && e.officeLocation.toLowerCase().includes(query)) ||
          (e.phone && e.phone.includes(query))
        );
      });
    }

    if (departmentFilter && departmentFilter !== 'ALL') {
      filteredList = filteredList.filter((e) => e.departmentName.toLowerCase() === departmentFilter.toLowerCase());
    }

    if (officeFilter && officeFilter !== 'ALL') {
      filteredList = filteredList.filter(
        (e) => Boolean(e.officeLocation) && e.officeLocation!.toLowerCase() === officeFilter.toLowerCase()
      );
    }

    if (statusFilter && statusFilter !== 'all') {
      filteredList = filteredList.filter((e) => e.status.toLowerCase() === statusFilter);
    }

    // Pagination
    const filteredTotal = filteredList.length;
    const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSize));
    const offset = (page - 1) * pageSize;
    const paginatedEmployees = filteredList.slice(offset, offset + pageSize);

    res.json({
      status: 'ok',
      emsConnected: isEmsAvailable,
      currentCompany: companyFilter,
      companies,
      summary: {
        totalEmployees,
        activeEmployees,
        departmentsCount: departments.length,
        officesCount: offices.length,
        authLinkedCount,
        departmentBreakdown,
      },
      departments,
      offices,
      pagination: {
        page,
        pageSize,
        total: filteredTotal,
        totalPages,
      },
      employees: paginatedEmployees,
    });
  })
);

// GET /api/admin/employees/:id - Retrieve single employee details
adminEmployeesRouter.get(
  '/employees/:id',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      throw new ApiError('invalid_request', 'Invalid employee ID');
    }

    let employeeRow: any = null;
    try {
      const result = await emsPool.query(
        `
        SELECT 
          e.*,
          COALESCE(o.name, 'SKYup News') as org_name,
          COALESCE(o.code, 'SKYUP') as org_code,
          COALESCE(d.name, 'General Staff') as department_name, 
          COALESCE(des.title, 'Staff Member') as designation_title,
          m.first_name as manager_first_name,
          m.last_name as manager_last_name
        FROM employees e
        LEFT JOIN organisations o ON e.org_id = o.id
        LEFT JOIN departments d ON e.department_id = d.id
        LEFT JOIN designations des ON e.designation_id = des.id
        LEFT JOIN employees m ON e.manager_id = m.id
        WHERE e.id = $1 AND (e.org_id = 3 OR lower(o.code) = 'ska' OR lower(o.name) LIKE '%auth%')
      `,
        [id]
      );
      employeeRow = result.rows[0];
    } catch (err: any) {
      logger.warn('Error fetching single employee from EMS', { error: err.message, id });
    }

    if (!employeeRow) {
      throw new ApiError('not_found', 'Employee record not found');
    }

    const email = (employeeRow.email || '').toLowerCase();
    const authUser = email
      ? await prisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            displayName: true,
            officeLocation: true,
            createdAt: true,
          },
        })
      : null;

    res.json({
      status: 'ok',
      employee: {
        id: employeeRow.id,
        orgId: employeeRow.org_id,
        orgName: employeeRow.org_name,
        orgCode: employeeRow.org_code,
        empCode: employeeRow.emp_code,
        firstName: employeeRow.first_name,
        lastName: employeeRow.last_name,
        fullName: [employeeRow.first_name, employeeRow.last_name].filter(Boolean).join(' '),
        email: employeeRow.email,
        phone: employeeRow.phone,
        gender: employeeRow.gender,
        dateOfBirth: employeeRow.date_of_birth,
        address: employeeRow.address,
        status: employeeRow.status,
        employmentType: employeeRow.employment_type,
        dateOfJoining: employeeRow.date_of_joining,
        officeLocation: employeeRow.office_location,
        baseSalary: employeeRow.base_salary,
        departmentName: employeeRow.department_name,
        designationTitle: employeeRow.designation_title,
        managerName: [employeeRow.manager_first_name, employeeRow.manager_last_name].filter(Boolean).join(' ') || null,
        notes: employeeRow.notes,
        createdAt: employeeRow.created_at,
        authLinked: Boolean(authUser),
        authUser,
      },
    });
  })
);

const syncAccountSchema = z.object({
  employeeId: z.number().int(),
  role: z.enum(['READER', 'EDITOR', 'ADMIN']).default('EDITOR'),
  temporaryPassword: z.string().min(6).default('PriyaGa@#1121'),
});

// POST /api/admin/employees/sync-account - Create or link SkyUp Auth user from employee record
adminEmployeesRouter.post(
  '/employees/sync-account',
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { employeeId, role, temporaryPassword } = syncAccountSchema.parse(req.body);

    const emsResult = await emsPool.query(`SELECT * FROM employees WHERE id = $1 AND (org_id = 3 OR org_id IS NULL)`, [employeeId]);
    const emp = emsResult.rows[0];
    if (!emp) {
      throw new ApiError('not_found', 'Employee record not found in EMS database');
    }

    if (!emp.email || !emp.email.trim()) {
      throw new ApiError('invalid_request', 'Employee record does not have a valid email address to authenticate');
    }

    const email = emp.email.trim().toLowerCase();
    const displayName = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'Staff Member';
    const passwordHash = await hashPassword(temporaryPassword);

    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    let user;
    if (existingUser) {
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          displayName,
          officeLocation: emp.office_location || existingUser.officeLocation,
          role,
          status: 'ACTIVE',
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email,
          displayName,
          passwordHash,
          role,
          status: 'ACTIVE',
          officeLocation: emp.office_location || null,
          contactPhone: emp.phone || null,
          emailVerifiedAt: new Date(),
        },
      });
    }

    res.json({
      status: 'ok',
      message: `Employee ${displayName} successfully synchronized with SkyUp Auth credentials.`,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        displayName: user.displayName,
      },
    });
  })
);
