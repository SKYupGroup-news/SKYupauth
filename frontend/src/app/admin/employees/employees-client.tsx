'use client';

import Link from 'next/link';
import { useEffect, useState, useMemo } from 'react';

export interface EmployeeRow {
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
  authRole?: string;
  authStatus?: string;
}

export interface EmployeeSummary {
  totalEmployees: number;
  activeEmployees: number;
  departmentsCount: number;
  officesCount: number;
  authLinkedCount: number;
  departmentBreakdown: Record<string, number>;
}

export interface CompanyInfo {
  id: number;
  name: string;
  code: string;
  count: number;
}

export function EmployeesClient({
  currentAdmin,
}: {
  currentAdmin: { id: string; email: string | null; role: string };
}) {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [summary, setSummary] = useState<EmployeeSummary | null>(null);
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [offices, setOffices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters — defaults to SKYup Auth
  const [companyFilter, setCompanyFilter] = useState('SKYup Auth');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [officeFilter, setOfficeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Modal / Detail view
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [syncMessage, setSyncMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 280);
    return () => clearTimeout(timer);
  }, [search]);

  // Load employees
  useEffect(() => {
    loadEmployees();
  }, [companyFilter, debouncedSearch, departmentFilter, officeFilter, statusFilter, page]);

  async function loadEmployees() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '25',
        company: companyFilter,
      });
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (departmentFilter !== 'ALL') params.set('department', departmentFilter);
      if (officeFilter !== 'ALL') params.set('office', officeFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const res = await fetch(`/api/admin/employees?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || 'Failed to load employee records.');
      }

      setEmployees(data.employees || []);
      setSummary(data.summary || null);
      if (data.companies) setCompanies(data.companies);
      if (data.departments) setDepartments(data.departments);
      if (data.offices) setOffices(data.offices);
      setTotalPages(data.pagination?.totalPages || 1);
      setTotalCount(data.pagination?.total || 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error loading employees');
    } finally {
      setLoading(false);
    }
  }

  // Provision or Sync Auth account for an employee
  async function handleSyncAccount(employee: EmployeeRow, desiredRole: 'EDITOR' | 'ADMIN' | 'READER' = 'EDITOR') {
    setSyncingId(employee.id);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/admin/employees/sync-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: employee.id,
          role: desiredRole,
          temporaryPassword: 'PriyaGa@#1121',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || 'Failed to sync employee account');
      }

      setSyncMessage({ text: data.message || 'Account successfully synchronized!' });
      // Update employee row in place
      setEmployees((prev) =>
        prev.map((e) =>
          e.id === employee.id
            ? {
                ...e,
                authLinked: true,
                authUserId: data.user.id,
                authRole: data.user.role,
                authStatus: data.user.status,
              }
            : e
        )
      );
      if (selectedEmployee && selectedEmployee.id === employee.id) {
        setSelectedEmployee((prev) =>
          prev
            ? {
                ...prev,
                authLinked: true,
                authUserId: data.user.id,
                authRole: data.user.role,
                authStatus: data.user.status,
              }
            : prev
        );
      }
    } catch (err: unknown) {
      setSyncMessage({
        text: err instanceof Error ? err.message : 'Failed to sync employee account',
        error: true,
      });
    } finally {
      setSyncingId(null);
    }
  }

  // Export to CSV
  function exportToCsv() {
    if (employees.length === 0) return;
    const headers = [
      'ID',
      'Organization',
      'Employee Code',
      'Full Name',
      'Email',
      'Phone',
      'Department',
      'Designation',
      'Office Location',
      'Status',
      'Employment Type',
      'Date of Joining',
      'Auth Linked',
    ];
    const rows = employees.map((e) => [
      e.id,
      `"${e.orgName}"`,
      `"${e.empCode}"`,
      `"${e.fullName}"`,
      `"${e.email}"`,
      `"${e.phone || ''}"`,
      `"${e.departmentName}"`,
      `"${e.designationTitle}"`,
      `"${e.officeLocation || ''}"`,
      `"${e.status}"`,
      `"${e.employmentType}"`,
      `"${e.dateOfJoining ? new Date(e.dateOfJoining).toLocaleDateString() : ''}"`,
      e.authLinked ? 'YES' : 'NO',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `skyup_employee_roster_${companyFilter.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Helper to format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Helper for initials
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0].toUpperCase())
      .join('');
  };

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      {/* Top Header */}
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">👔 Employee Directory</h1>
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Admin Access: {currentAdmin.email}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Corporate staff roster, bureau locations, organizational departments, and identity credentials.
          </p>
        </div>

        {/* Navigation Action Links */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportToCsv}
            disabled={employees.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:border-brand disabled:opacity-50"
            title="Download CSV Roster"
          >
            <span>📥</span> Export CSV
          </button>

          <Link
            href="/admin/users"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground"
          >
            👥 Audience Profiles
          </Link>

          <Link
            href="/admin/audience"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground"
          >
            Subscribers
          </Link>

          <Link
            href="/admin/comments"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground"
          >
            Comments
          </Link>

          {currentAdmin.email === 'admin@skyupnews.com' && (
            <Link
              href="/admin/integration"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground"
            >
              <span>🔌</span> API Integration
            </Link>
          )}

          <Link
            href="/account"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground"
          >
            My Account
          </Link>
        </div>
      </div>

      {/* Organization / Company Selector Pills */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-muted mr-1">
            Company Scope:
          </span>
          {companies.map((c) => {
            const isSelected = true;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCompanyFilter(c.name);
                  setDepartmentFilter('ALL');
                  setPage(1);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold bg-brand text-brand-contrast shadow-sm"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white"></span>
                {c.name}
                <span className="ml-1 rounded-full bg-black/15 dark:bg-white/15 px-1.5 py-0.2 text-[10px] font-bold">
                  {c.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="text-xs text-muted">
          Active: <strong className="text-foreground">SKYup Auth</strong>
        </div>
      </div>

      {/* KPI Stats Row */}
      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Total Employees</span>
          <p className="mt-2 text-2xl font-bold text-foreground">
            {summary ? summary.totalEmployees : '—'}
          </p>
          <span className="mt-1 block text-xs text-muted">
            {companyFilter === 'ALL' ? 'Across all units' : `In ${companyFilter}`}
          </span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Active Staff</span>
          <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {summary ? summary.activeEmployees : '—'}
          </p>
          <span className="mt-1 block text-xs text-muted">Verified active status</span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Departments</span>
          <p className="mt-2 text-2xl font-bold text-foreground">
            {summary ? summary.departmentsCount : '—'}
          </p>
          <span className="mt-1 block text-xs text-muted">Active departments</span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Bureaus & Offices</span>
          <p className="mt-2 text-2xl font-bold text-[#b5801a]">
            {summary ? summary.officesCount : '—'}
          </p>
          <span className="mt-1 block text-xs text-muted">Field offices & bureaus</span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Auth Linked</span>
          <p className="mt-2 text-2xl font-bold text-brand">
            {summary ? summary.authLinkedCount : '—'}
          </p>
          <span className="mt-1 block text-xs text-muted">Platform login accounts</span>
        </div>
      </section>

      {/* Filter and Search Bar */}
      <section className="mt-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search box */}
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, employee code, title..."
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-brand"
            />
            <span className="pointer-events-none absolute left-3 top-2.5 text-xs text-muted">
              🔍
            </span>
          </div>

          {/* Department Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted">Dept:</span>
            <select
              value={departmentFilter}
              onChange={(e) => {
                setDepartmentFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand"
            >
              <option value="ALL">All Departments ({departments.length})</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          {/* Office Location Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted">Office:</span>
            <select
              value={officeFilter}
              onChange={(e) => {
                setOfficeFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand"
            >
              <option value="ALL">All Bureaus & Offices</option>
              {offices.map((off) => (
                <option key={off} value={off}>
                  {off}
                </option>
              ))}
            </select>
          </div>

          {/* Status filter pills */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
            {[
              { id: 'all', label: 'All Status' },
              { id: 'active', label: 'Active' },
            ].map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => {
                  setStatusFilter(st.id);
                  setPage(1);
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  statusFilter === st.id
                    ? 'bg-brand text-brand-contrast'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* Refresh button */}
          <button
            type="button"
            onClick={loadEmployees}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-muted transition hover:border-brand/50 hover:text-foreground disabled:opacity-50"
            title="Refresh list"
          >
            <span className={loading ? 'animate-spin' : ''}>🔄</span>
            Refresh
          </button>
        </div>
      </section>

      {/* Error state */}
      {error && (
        <div className="mt-4 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          ⚠️ {error}
        </div>
      )}

      {/* Employee List Table */}
      <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-background/50 text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3.5 font-semibold">Employee</th>
                <th className="px-4 py-3.5 font-semibold">Code</th>
                <th className="px-4 py-3.5 font-semibold">Department & Designation</th>
                <th className="px-4 py-3.5 font-semibold">Company / Org</th>
                <th className="px-4 py-3.5 font-semibold">Contact</th>
                <th className="px-4 py-3.5 font-semibold">Manager</th>
                <th className="px-4 py-3.5 font-semibold">Auth Status</th>
                <th className="px-4 py-3.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading && employees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-2xl animate-spin">⏳</span>
                      <span>Loading employee directory...</span>
                    </div>
                  </td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted">
                    <p className="text-base font-medium">No employees found for this filter</p>
                    <p className="mt-1 text-xs">Try switching organization or clearing filters.</p>
                  </td>
                </tr>
              ) : (
                employees.map((emp) => (
                  <tr key={emp.id} className="transition hover:bg-background/40">
                    {/* Employee Info */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand">
                          {getInitials(emp.fullName)}
                        </div>
                        <div>
                          <div className="font-semibold text-foreground flex items-center gap-1.5">
                            {emp.fullName}
                            {emp.gender && (
                              <span className="text-[11px] text-muted font-normal capitalize">
                                ({emp.gender})
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted">
                            Joined {formatDate(emp.dateOfJoining)}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Code */}
                    <td className="px-4 py-3.5">
                      <span className="inline-block rounded bg-background px-2 py-0.5 font-mono text-xs font-semibold text-foreground border border-border">
                        {emp.empCode}
                      </span>
                    </td>

                    {/* Department & Designation */}
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-foreground">{emp.designationTitle}</div>
                      <div className="text-xs text-muted capitalize">{emp.departmentName}</div>
                    </td>

                    {/* Company / Org */}
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1 rounded bg-background px-2 py-0.5 text-xs font-medium text-foreground border border-border">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                        {emp.orgName}
                      </span>
                    </td>

                    {/* Contact */}
                    <td className="px-4 py-3.5 text-xs">
                      <div className="font-mono text-foreground">
                        <a href={`mailto:${emp.email}`} className="hover:underline hover:text-brand">
                          {emp.email}
                        </a>
                      </div>
                      {emp.phone && (
                        <div className="mt-0.5 text-muted">{emp.phone}</div>
                      )}
                    </td>

                    {/* Manager */}
                    <td className="px-4 py-3.5 text-xs text-muted">
                      {emp.managerName ? (
                        <span className="font-medium text-foreground">
                          {emp.managerName}
                        </span>
                      ) : (
                        <span className="text-muted/60">—</span>
                      )}
                    </td>

                    {/* Auth Status */}
                    <td className="px-4 py-3.5">
                      {emp.authLinked ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                          Linked ({emp.authRole || 'USER'})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                          Unsynced
                        </span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEmployee(emp);
                          setSyncMessage(null);
                        }}
                        className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-brand hover:bg-surface"
                      >
                        View Dossier
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted">
            <div>
              Showing {employees.length} of {totalCount} employees in {companyFilter === 'ALL' ? 'all organizations' : companyFilter}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition hover:border-brand disabled:opacity-40"
              >
                &larr; Prev
              </button>
              <span className="px-2">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition hover:border-brand disabled:opacity-40"
              >
                Next &rarr;
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Employee Dossier Modal */}
      {selectedEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-border bg-background/50 px-6 py-5">
              <div className="flex items-center gap-3.5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-lg font-bold text-brand-contrast shadow-sm">
                  {getInitials(selectedEmployee.fullName)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-foreground">
                      {selectedEmployee.fullName}
                    </h2>
                    <span className="rounded bg-background px-2 py-0.5 font-mono text-xs font-semibold text-muted border border-border">
                      {selectedEmployee.empCode}
                    </span>
                  </div>
                  <p className="text-sm text-muted">
                    {selectedEmployee.designationTitle} &bull; {selectedEmployee.departmentName} ({selectedEmployee.orgName})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEmployee(null)}
                className="rounded-lg border border-border p-1.5 text-muted transition hover:bg-background hover:text-foreground"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="max-h-[75vh] overflow-y-auto px-6 py-5 space-y-6">
              {/* Sync Alert Banner if any */}
              {syncMessage && (
                <div
                  className={`rounded-xl border p-3.5 text-sm ${
                    syncMessage.error
                      ? 'border-danger/30 bg-danger/10 text-danger'
                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {syncMessage.error ? '⚠️ ' : '✅ '} {syncMessage.text}
                </div>
              )}

              {/* Grid 1: Basic Info */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Corporate Placement
                </h3>
                <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border bg-background p-3">
                    <span className="text-xs text-muted block">Organization</span>
                    <span className="text-sm font-semibold text-foreground">
                      {selectedEmployee.orgName} ({selectedEmployee.orgCode})
                    </span>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-3">
                    <span className="text-xs text-muted block">Department</span>
                    <span className="text-sm font-semibold text-foreground capitalize">
                      {selectedEmployee.departmentName}
                    </span>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-3">
                    <span className="text-xs text-muted block">Designation</span>
                    <span className="text-sm font-semibold text-foreground">
                      {selectedEmployee.designationTitle}
                    </span>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-3">
                    <span className="text-xs text-muted block">Bureau / Office</span>
                    <span className="text-sm font-semibold text-foreground">
                      {selectedEmployee.officeLocation || 'Headquarters'}
                    </span>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-3">
                    <span className="text-xs text-muted block">Reporting Manager</span>
                    <span className="text-sm font-semibold text-foreground">
                      {selectedEmployee.managerName || 'None assigned'}
                    </span>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-3">
                    <span className="text-xs text-muted block">Joining Date</span>
                    <span className="text-sm font-semibold text-foreground">
                      {formatDate(selectedEmployee.dateOfJoining)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Grid 2: Contact & Personal Details */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Contact & Identity
                </h3>
                <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-background p-3">
                    <span className="text-xs text-muted block">Email Address</span>
                    <span className="font-mono text-sm font-medium text-foreground">
                      {selectedEmployee.email}
                    </span>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-3">
                    <span className="text-xs text-muted block">Phone Number</span>
                    <span className="text-sm font-medium text-foreground">
                      {selectedEmployee.phone || 'Not provided'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Grid 3: SkyUp Auth Credentials Status */}
              <div className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <span>🔐</span> SkyUp Platform Authentication
                    </h3>
                    <p className="mt-0.5 text-xs text-muted">
                      Controls login access to SkyUp News staff and administrative applications.
                    </p>
                  </div>

                  {selectedEmployee.authLinked ? (
                    <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      ✓ Active ({selectedEmployee.authRole})
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                      Not Linked
                    </span>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                  <button
                    type="button"
                    onClick={() => handleSyncAccount(selectedEmployee, 'EDITOR')}
                    disabled={syncingId === selectedEmployee.id}
                    className="rounded-lg border border-brand bg-brand px-3.5 py-1.5 text-xs font-semibold text-brand-contrast transition hover:bg-brand-strong disabled:opacity-50"
                  >
                    {syncingId === selectedEmployee.id
                      ? 'Provisioning...'
                      : selectedEmployee.authLinked
                      ? 'Re-sync Account (Role: EDITOR)'
                      : 'Provision Staff Login (EDITOR)'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSyncAccount(selectedEmployee, 'ADMIN')}
                    disabled={syncingId === selectedEmployee.id}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-brand disabled:opacity-50"
                  >
                    Promote to Admin Account
                  </button>

                  <span className="text-[11px] text-muted">
                    Default temp password: <code className="font-mono text-foreground">PriyaGa@#1121</code>
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end border-t border-border bg-background/50 px-6 py-3.5">
              <button
                type="button"
                onClick={() => setSelectedEmployee(null)}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition hover:bg-background"
              >
                Close Dossier
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
