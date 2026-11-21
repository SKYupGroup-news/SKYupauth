import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError, asyncHandler } from '@/lib/http';
import { requireAdmin, type AuthenticatedRequest } from '@/lib/current-user';
import { hashPassword } from '@/lib/password';
import type { Role } from '@/generated/prisma';

export const adminIntegrationRouter = Router();

// Strict RBAC: Only primary administrator (admin@skyupnews.com) can access and execute API integrations
const requirePrimaryAdmin = (req: AuthenticatedRequest, res: any, next: any) => {
  if (!req.user || req.user.role !== 'ADMIN' || req.user.email !== 'admin@skyupnews.com') {
    throw new ApiError('forbidden', 'Access restricted. Only primary administrator (admin@skyupnews.com) can configure and execute API integrations.');
  }
  next();
};

const emsPullSchema = z.object({
  apiUrl: z.string().url().default('http://localhost:4005/api/integration/companies/SKA'),
  apiKey: z.string().optional().default('ems_5e03df05_BotH3RUsiebHG1RnfYjcONRRzCemMrgM1Cdfy2YWTE8'),
  defaultRole: z.enum(['READER', 'EDITOR', 'ADMIN']).default('READER'),
  defaultPassword: z.string().min(6).default('PriyaGa@#1121'),
  departmentFilter: z.string().optional().default(''),
});

const endpointTestSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'HEAD']).default('GET'),
  authHeader: z.string().optional(),
});

// GET /api/admin/integration/config - Connector Status & System Metadata
adminIntegrationRouter.get(
  '/config',
  requireAdmin,
  requirePrimaryAdmin,
  asyncHandler(async (req, res) => {
    const totalUsers = await prisma.user.count();
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    const readerCount = await prisma.user.count({ where: { role: 'READER' } });
    const editorCount = await prisma.user.count({ where: { role: 'EDITOR' } });

    res.json({
      status: 'ok',
      authorizedAdmin: 'admin@skyupnews.com',
      connectors: [
        {
          id: 'news_feed_service',
          name: 'SkyUp News (Audience Platform)',
          url: 'https://skyupnews.com',
          port: 443,
          type: 'UPSTREAM_NEWS_PLATFORM',
          status: 'ONLINE',
        },
        {
          id: 'reporter_backend',
          name: 'Media House (Editorial Gateway)',
          url: 'https://mediahouse.skyupnews.com/',
          port: 443,
          type: 'EDITORIAL_API',
          status: 'ONLINE',
        },
        {
          id: 'feed_analyst',
          name: 'News Analyst & Intelligence Engine',
          url: 'https://newsanalyst.skyupnews.com/login',
          port: 443,
          type: 'FASTAPI_ANALYTICS',
          status: 'ONLINE',
        },
        {
          id: 'auth_backend',
          name: 'SkyUp Auth Identity Service',
          url: 'https://auth.skyupnews.com/api/health',
          port: 443,
          type: 'EXPRESS_PRISMA',
          status: 'ONLINE',
        },
      ],
      stats: {
        totalUsers,
        adminCount,
        readerCount,
        editorCount,
      },
    });
  })
);

// POST /api/admin/integration/test - Probe microservice latency and connectivity
adminIntegrationRouter.post(
  '/test',
  requireAdmin,
  requirePrimaryAdmin,
  asyncHandler(async (req, res) => {
    const { url, method, authHeader } = endpointTestSchema.parse(req.body);
    const start = Date.now();

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json, text/html, */*',
        'User-Agent': 'SkyUp-Auth-Integration-Probe/1.0',
      };
      if (authHeader) headers['Authorization'] = authHeader;

      const response = await fetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(8000),
      });

      const latencyMs = Date.now() - start;
      res.json({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        latencyMs,
        url,
      });
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      res.json({
        ok: false,
        status: 0,
        statusText: err?.message || 'Connection timeout or refused',
        latencyMs,
        url,
      });
    }
  })
);

// POST /api/admin/integration/ems/pull - Pull / synchronize users from EMS
adminIntegrationRouter.post(
  '/ems/pull',
  requireAdmin,
  requirePrimaryAdmin,
  asyncHandler(async (req, res) => {
    const { apiUrl, apiKey, defaultRole, defaultPassword, departmentFilter } = emsPullSchema.parse(req.body);

    const cleanBaseUrl = apiUrl.replace(/\/+$/, '');
    let targetUrlStr = cleanBaseUrl;
    if (!targetUrlStr.endsWith('/employees')) {
      targetUrlStr = `${targetUrlStr}/employees`;
    }
    const targetUrl = new URL(targetUrlStr);
    if (departmentFilter && departmentFilter.trim()) {
      targetUrl.searchParams.set('department', departmentFilter.trim());
    }

    let response: Response;
    try {
      response = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: {
          ...(apiKey.trim()
            ? {
                Authorization: `Bearer ${apiKey.trim()}`,
                'x-api-key': apiKey.trim(),
              }
            : {}),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Network error';
      throw new ApiError(
        'internal_error',
        `Could not reach external EMS API at ${targetUrl.toString()}: ${message}. Verify that the EMS microservice is running.`
      );
    }

    if (!response.ok) {
      let detail = '';
      try {
        const errBody: any = await response.json();
        detail = errBody?.error || errBody?.message || JSON.stringify(errBody);
      } catch {
        detail = await response.text();
      }
      throw new ApiError(
        response.status === 401 || response.status === 403 ? 'forbidden' : 'invalid_request',
        `EMS API error (HTTP ${response.status}): ${detail || 'Unauthorized or invalid API key'}`
      );
    }

    const payload: any = await response.json();
    const rawList = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.employees)
        ? payload.employees
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

    if (rawList.length === 0) {
      return res.json({
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
      // Scope validation: Only import employees belonging to SKYup Auth
      const itemCompany = (item.company || item.company_name || '').toLowerCase();
      const itemCode = (item.company_code || '').toUpperCase();
      if (itemCompany && !itemCompany.includes('auth') && itemCode && itemCode !== 'SKA') {
        continue;
      }

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

    return res.json({
      ok: true,
      fetchedCount: rawList.length,
      createdCount,
      updatedCount,
      workspace: payload?.workspace || null,
      users: importedUsers,
      message: `Successfully integrated: ${createdCount} new users created, ${updatedCount} existing profiles synchronized.`,
    });
  })
);

