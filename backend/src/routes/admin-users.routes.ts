import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError, asyncHandler } from '@/lib/http';
import { requireAdmin } from '@/lib/current-user';
import { hashPassword } from '@/lib/password';
import type { Prisma, UserStatus } from '@/generated/prisma';

export const adminUsersRouter = Router();

const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  phone: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  officeLocation: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).default('ACTIVE'),
  password: z.string().min(8),
});

const updateUserSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  officeLocation: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
  password: z.string().min(8).optional(),
});

// GET /api/admin/users
adminUsersRouter.get(
  '/users',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'ALL';
    const verified = typeof req.query.verified === 'string' ? req.query.verified : 'all';
    const country = typeof req.query.country === 'string' ? req.query.country.trim() : '';
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

    const where: Prisma.UserWhereInput = {};

    if (query) {
      where.OR = [
        { email: { contains: query, mode: 'insensitive' } },
        { displayName: { contains: query, mode: 'insensitive' } },
        { phone: { contains: query } },
        { city: { contains: query, mode: 'insensitive' } },
        { state: { contains: query, mode: 'insensitive' } },
        { country: { contains: query, mode: 'insensitive' } },
      ];
    }

    if (status !== 'ALL') {
      where.status = status as UserStatus;
    }

    if (verified === 'verified') {
      where.OR = [{ emailVerifiedAt: { not: null } }, { phoneVerifiedAt: { not: null } }];
    } else if (verified === 'unverified') {
      where.emailVerifiedAt = null;
      where.phoneVerifiedAt = null;
    }

    if (country) {
      where.country = country;
    }
    if (state) {
      where.state = state;
    }

    const [users, total, activeUsers, suspendedUsers, verifiedUsers, paidSubscribers, distinctLocations] =
      await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            email: true,
            phone: true,
            displayName: true,
            avatarUrl: true,
            role: true,
            status: true,
            country: true,
            state: true,
            city: true,
            officeLocation: true,
            createdAt: true,
            emailVerifiedAt: true,
            phoneVerifiedAt: true,
            passwordHash: true,
            subscription: {
              select: {
                status: true,
                currentPeriodEnd: true,
              },
            },
            oauthAccounts: {
              select: { provider: true },
            },
          },
        }),
        prisma.user.count({ where }),
        prisma.user.count({ where: { status: 'ACTIVE' } }),
        prisma.user.count({ where: { status: 'SUSPENDED' } }),
        prisma.user.count({
          where: {
            OR: [{ emailVerifiedAt: { not: null } }, { phoneVerifiedAt: { not: null } }],
          },
        }),
        prisma.subscription.count({
          where: {
            status: { in: ['ACTIVE', 'TRIALING'] },
            currentPeriodEnd: { gte: new Date() },
          },
        }),
        prisma.user.findMany({
          where: { country: { not: null } },
          select: { country: true, state: true },
          distinct: ['country', 'state'],
        }),
      ]);

    const countryStateMap: Record<string, string[]> = {};
    const countrySet = new Set<string>();
    const stateSet = new Set<string>();

    for (const loc of distinctLocations) {
      if (loc.country) {
        countrySet.add(loc.country);
        if (!countryStateMap[loc.country]) {
          countryStateMap[loc.country] = [];
        }
        if (loc.state && !countryStateMap[loc.country].includes(loc.state)) {
          countryStateMap[loc.country].push(loc.state);
          stateSet.add(loc.state);
        }
      }
    }

    for (const c of Object.keys(countryStateMap)) {
      countryStateMap[c].sort((a, b) => a.localeCompare(b));
    }

    const safeUsers = users.map((u) => {
      const providers = u.oauthAccounts.map((a) => a.provider);
      let authSource = 'Password';
      if (providers.length > 0) {
        authSource = providers.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', ');
      } else if (!u.passwordHash && u.phone) {
        authSource = 'Phone OTP';
      }

      return {
        id: u.id,
        email: u.email,
        phone: u.phone,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        role: u.role,
        status: u.status,
        country: u.country,
        state: u.state,
        city: u.city,
        officeLocation: u.officeLocation,
        createdAt: u.createdAt,
        emailVerified: u.emailVerifiedAt !== null,
        phoneVerified: u.phoneVerifiedAt !== null,
        authSource,
        isSubscriber:
          u.subscription?.status === 'ACTIVE' &&
          u.subscription.currentPeriodEnd !== null &&
          new Date(u.subscription.currentPeriodEnd) >= new Date(),
      };
    });

    res.json({
      summary: {
        totalAudience: total,
        activeUsers,
        suspendedUsers,
        verifiedUsers,
        paidSubscribers,
      },
      countries: Array.from(countrySet).sort(),
      states: Array.from(stateSet).sort(),
      countryStateMap,
      users: safeUsers,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  })
);

// POST /api/admin/users
adminUsersRouter.post(
  '/users',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const email = input.email.trim().toLowerCase();

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email }, ...(input.phone ? [{ phone: input.phone }] : [])],
      },
    });

    if (existing) {
      if (existing.email === email) {
        throw new ApiError('conflict', 'A user with that email already exists.');
      }
      throw new ApiError('conflict', 'A user with that phone already exists.');
    }

    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: input.displayName,
        phone: input.phone || null,
        country: input.country || null,
        state: input.state || null,
        city: input.city || null,
        officeLocation: input.officeLocation || null,
        status: input.status,
        role: 'READER',
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });

    res.status(201).json({ ok: true, user });
  })
);

// PATCH /api/admin/users
adminUsersRouter.patch(
  '/users',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = updateUserSchema.parse(req.body);

    const updateData: Prisma.UserUpdateInput = {};
    if (input.displayName !== undefined) updateData.displayName = input.displayName;
    if (input.phone !== undefined) updateData.phone = input.phone;
    if (input.country !== undefined) updateData.country = input.country;
    if (input.state !== undefined) updateData.state = input.state;
    if (input.city !== undefined) updateData.city = input.city;
    if (input.officeLocation !== undefined) updateData.officeLocation = input.officeLocation;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.password) {
      updateData.passwordHash = await hashPassword(input.password);
    }

    const updated = await prisma.user.update({
      where: { id: input.id },
      data: updateData,
    });

    res.json({ ok: true, user: updated });
  })
);

// DELETE /api/admin/users
adminUsersRouter.delete(
  '/users',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.body;
    if (!id) throw new ApiError('invalid_request', 'Missing user ID');

    await prisma.user.delete({ where: { id } });
    res.json({ ok: true, id });
  })
);
