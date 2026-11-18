import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute, parseJson } from '@/lib/http';
import { hashPassword } from '@/lib/password';
import { z } from 'zod';
import type { Role } from '@/generated/prisma';

const emsPullSchema = z.object({
  apiUrl: z.string().url().default('http://localhost:4005/api/integration/companies/SKA'),
  apiKey: z.string().min(1, 'API key is required'),
  defaultRole: z.enum(['READER', 'EDITOR', 'ADMIN']).default('READER'),
  defaultPassword: z.string().min(6).default('password123'),
  departmentFilter: z.string().optional().default(''),
});

export const POST = handleRoute(async (request: Request) => {
  const actor = await requireUser(request);
  if (actor.role !== 'ADMIN') {
    throw new ApiError('forbidden', 'Only administrators can import users from external APIs.');
  }

  const { apiUrl, apiKey, defaultRole, defaultPassword, departmentFilter } = await parseJson(
    request,
    emsPullSchema,
  );

  const cleanBaseUrl = apiUrl.replace(/\/+$/, '');
  const targetUrl = new URL(`${cleanBaseUrl}/employees`);
  if (departmentFilter && departmentFilter.trim()) {
    targetUrl.searchParams.set('department', departmentFilter.trim());
  }

  let response: Response;
  try {
    response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Network error';
    throw new ApiError(
      'internal_error',
      `Could not reach external EMS API at ${targetUrl.toString()}: ${message}. Verify that the EMS server is running.`,
    );
  }

  if (!response.ok) {
    let detail = '';
    try {
      const errBody = await response.json();
      detail = errBody?.error || errBody?.message || JSON.stringify(errBody);
    } catch {
      detail = await response.text();
    }
    throw new ApiError(
      response.status === 401 || response.status === 403 ? 'forbidden' : 'invalid_request',
      `EMS API error (HTTP ${response.status}): ${detail || 'Unauthorized or invalid API key'}`,
    );
  }

  const payload = await response.json();
  const rawList = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.employees)
      ? payload.employees
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  if (rawList.length === 0) {
    return NextResponse.json({
      ok: true,
      fetchedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      workspace: payload?.workspace || null,
      message: 'EMS API responded successfully, but 0 employee records were returned.',
    });
  }

  const defaultHash = await hashPassword(defaultPassword);
  let createdCount = 0;
  let updatedCount = 0;
  const importedUsers: Array<{ email: string; name: string | null; isNew: boolean }> = [];

  for (const item of rawList) {
    const email = (item.login_email || item.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;

    const name = item.name || item.displayName || (item.first_name ? `${item.first_name} ${item.last_name || ''}`.trim() : null) || email.split('@')[0];
    const country = item.country || null;
    const city = item.city || item.department || null;
    const officeLocation = item.office_location || item.officeLocation || item.company_name || item.company || null;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          displayName: name,
          country: country || existing.country,
          city: city || existing.city,
          officeLocation: officeLocation || existing.officeLocation,
          status: 'ACTIVE',
        },
      });
      updatedCount++;
      importedUsers.push({ email, name, isNew: false });
    } else {
      await prisma.user.create({
        data: {
          email,
          displayName: name,
          passwordHash: defaultHash,
          role: defaultRole as Role,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          country,
          city,
          officeLocation,
          preferredTopics: ['World', 'Business', 'Tech'],
        },
      });
      createdCount++;
      importedUsers.push({ email, name, isNew: true });
    }
  }

  return NextResponse.json({
    ok: true,
    fetchedCount: rawList.length,
    createdCount,
    updatedCount,
    workspace: payload?.workspace || null,
    users: importedUsers,
    message: `Successfully imported ${createdCount} new users and updated ${updatedCount} users in SkyUp Auth database.`,
  });
});
