import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser, avatarSrcFor } from '@/lib/current-user';
import { ApiError, handleRoute, parseJson } from '@/lib/http';
import { hashPassword } from '@/lib/password';
import { z } from 'zod';
import type { Prisma, Role, UserStatus } from '@/generated/prisma';

const createUserSchema = z.object({
  email: z.string().email('Valid email is required'),
  displayName: z.string().min(1, 'Display name is required'),
  phone: z.string().optional().nullable(),
  role: z.enum(['READER', 'EDITOR', 'ADMIN']).default('READER'),
  status: z.enum(['ACTIVE', 'SUSPENDED']).default('ACTIVE'),
  password: z.string().min(6, 'Password must be at least 6 characters').default('password123'),
  country: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  officeLocation: z.string().optional().nullable(),
});

const updateUserSchema = z.object({
  id: z.string().min(1, 'User ID is required'),
  role: z.enum(['READER', 'EDITOR', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  displayName: z.string().optional(),
  phone: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  officeLocation: z.string().optional().nullable(),
  newPassword: z.string().min(6).optional(),
});

const deleteUserSchema = z.object({
  id: z.string().min(1, 'User ID is required'),
});

export const GET = handleRoute(async (request: Request) => {
  const actor = await requireUser(request);
  if (actor.role !== 'ADMIN') {
    throw new ApiError('forbidden', 'Only administrators can access user data.');
  }

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() || '';
  const statusParam = url.searchParams.get('status')?.toUpperCase() || 'ALL';
  const verifiedParam = url.searchParams.get('verified')?.toLowerCase() || 'all';
  const countryParam = url.searchParams.get('country')?.trim() || '';
  const stateParam = url.searchParams.get('state')?.trim() || '';
  const officeLocationParam = url.searchParams.get('officeLocation')?.trim() || '';
  const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || '25') || 25));

  const where: Prisma.UserWhereInput = {};

  if (q) {
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { displayName: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
      { country: { contains: q, mode: 'insensitive' } },
      { state: { contains: q, mode: 'insensitive' } },
      { city: { contains: q, mode: 'insensitive' } },
      { officeLocation: { contains: q, mode: 'insensitive' } },
    ];
  }

  // Audience country & state filter
  if (countryParam && countryParam.toLowerCase() !== 'all') {
    where.country = { equals: countryParam, mode: 'insensitive' };
  }

  if (stateParam && stateParam.toLowerCase() !== 'all') {
    where.state = { equals: stateParam, mode: 'insensitive' };
  }

  // Location scoping: if the logged-in staff is restricted to an office location,
  // scope user list to their allotted location. Admins can view and filter any location.
  if (actor.officeLocation && actor.role !== 'ADMIN') {
    where.officeLocation = actor.officeLocation;
  } else if (officeLocationParam) {
    where.officeLocation = { contains: officeLocationParam, mode: 'insensitive' };
  }

  if (statusParam === 'ACTIVE' || statusParam === 'SUSPENDED') {
    where.status = statusParam as UserStatus;
  }

  if (verifiedParam === 'verified') {
    where.emailVerifiedAt = { not: null };
  } else if (verifiedParam === 'unverified') {
    where.emailVerifiedAt = null;
  }

  const skip = (page - 1) * pageSize;

  const [
    totalUsers,
    activeUsers,
    suspendedUsers,
    verifiedUsers,
    paidUsers,
    filteredTotal,
    users,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where: { status: 'SUSPENDED' } }),
    prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
    prisma.subscription.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        displayName: true,
        phone: true,
        role: true,
        status: true,
        country: true,
        state: true,
        city: true,
        officeLocation: true,
        avatarUrl: true,
        avatarUpdatedAt: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        passwordHash: true,
        createdAt: true,
        updatedAt: true,
        subscription: {
          select: {
            status: true,
            planKey: true,
          },
        },
        oauthAccounts: {
          select: { provider: true },
        },
        _count: {
          select: {
            sessions: {
              where: {
                revokedAt: null,
                expiresAt: { gt: new Date() },
              },
            },
          },
        },
      },
    }),
  ]);

  const [distinctCountries, distinctStates, countryStatePairs, distinctLocations] = await Promise.all([
    prisma.user.findMany({
      where: { country: { not: null } },
      select: { country: true },
      distinct: ['country'],
    }),
    prisma.user.findMany({
      where: {
        state: { not: null },
        ...(countryParam && countryParam.toLowerCase() !== 'all'
          ? { country: { equals: countryParam, mode: 'insensitive' } }
          : {}),
      },
      select: { state: true },
      distinct: ['state'],
    }),
    prisma.user.findMany({
      where: { country: { not: null }, state: { not: null } },
      select: { country: true, state: true },
      distinct: ['country', 'state'],
    }),
    prisma.user.findMany({
      where: { officeLocation: { not: null } },
      select: { officeLocation: true },
      distinct: ['officeLocation'],
    }),
  ]);
  const countries = distinctCountries.map((c) => c.country).filter(Boolean) as string[];
  const states = distinctStates.map((s) => s.state).filter(Boolean) as string[];
  const officeLocations = distinctLocations.map((l) => l.officeLocation).filter(Boolean) as string[];

  const countryStateMap: Record<string, string[]> = {};
  for (const pair of countryStatePairs) {
    if (pair.country && pair.state) {
      if (!countryStateMap[pair.country]) {
        countryStateMap[pair.country] = [];
      }
      if (!countryStateMap[pair.country].includes(pair.state)) {
        countryStateMap[pair.country].push(pair.state);
      }
    }
  }

  const formattedUsers = users.map((u) => {
    const oAuthProviders = u.oauthAccounts.map((a) => a.provider);
    let authSource = 'Password';
    if (oAuthProviders.length > 0) {
      authSource = oAuthProviders.join(', ');
    } else if (u.phone && !u.email) {
      authSource = 'Phone OTP';
    }

    const isPaid = u.subscription?.status === 'ACTIVE';

    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      phone: u.phone,
      role: u.role,
      status: u.status,
      country: u.country,
      state: u.state,
      city: u.city,
      officeLocation: u.officeLocation,
      avatarSrc: avatarSrcFor(u),
      emailVerified: u.emailVerifiedAt !== null,
      phoneVerified: u.phoneVerifiedAt !== null,
      hasPassword: u.passwordHash !== null,
      authSource,
      isPaid,
      planKey: u.subscription?.planKey || null,
      activeSessions: u._count.sessions,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    };
  });

  return NextResponse.json({
    summary: {
      totalUsers,
      activeUsers,
      suspendedUsers,
      verifiedUsers,
      paidUsers,
    },
    pagination: {
      page,
      pageSize,
      total: filteredTotal,
      totalPages: Math.ceil(filteredTotal / pageSize) || 1,
    },
    countries,
    states,
    countryStateMap,
    officeLocations,
    users: formattedUsers,
  });
});

export const POST = handleRoute(async (request: Request) => {
  const actor = await requireUser(request);
  if (actor.role !== 'ADMIN') {
    throw new ApiError('forbidden', 'Only administrators can create users.');
  }

  const data = await parseJson(request, createUserSchema);
  const email = data.email.trim().toLowerCase();

  const existingEmail = await prisma.user.findUnique({ where: { email } });
  if (existingEmail) {
    throw new ApiError('conflict', `A profile with email ${email} already exists.`);
  }

  if (data.phone) {
    const existingPhone = await prisma.user.findUnique({ where: { phone: data.phone.trim() } });
    if (existingPhone) {
      throw new ApiError('conflict', `A profile with phone ${data.phone} already exists.`);
    }
  }

  const passwordHash = await hashPassword(data.password);

  const newUser = await prisma.user.create({
    data: {
      email,
      displayName: data.displayName.trim(),
      phone: data.phone?.trim() || null,
      role: 'READER' as Role, // Always READER for audience customer profiles
      status: data.status as UserStatus,
      passwordHash,
      emailVerifiedAt: new Date(),
      country: data.country || null,
      state: data.state || null,
      city: data.city || null,
      officeLocation: data.officeLocation ? data.officeLocation.trim() : null,
      preferredTopics: ['World', 'Business', 'Tech'],
    },
  });

  return NextResponse.json({
    ok: true,
    message: `Audience profile for ${newUser.email} created successfully.`,
    user: {
      id: newUser.id,
      email: newUser.email,
      displayName: newUser.displayName,
      role: newUser.role,
      status: newUser.status,
      officeLocation: newUser.officeLocation,
    },
  });
});

export const PATCH = handleRoute(async (request: Request) => {
  const actor = await requireUser(request);
  if (actor.role !== 'ADMIN') {
    throw new ApiError('forbidden', 'Only administrators can update users.');
  }

  const data = await parseJson(request, updateUserSchema);
  const user = await prisma.user.findUnique({ where: { id: data.id } });
  if (!user) {
    throw new ApiError('not_found', 'Profile not found.');
  }

  // Prevent admin from suspending themselves
  if (user.id === actor.id && data.status === 'SUSPENDED') {
    throw new ApiError('forbidden', 'You cannot suspend your own administrator account.');
  }

  const updateData: Prisma.UserUpdateInput = {};
  if (data.status) updateData.status = data.status as UserStatus;
  if (data.displayName !== undefined) updateData.displayName = data.displayName.trim();
  if (data.country !== undefined) updateData.country = data.country;
  if (data.state !== undefined) updateData.state = data.state;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.officeLocation !== undefined) updateData.officeLocation = data.officeLocation ? data.officeLocation.trim() : null;
  if (data.phone !== undefined) updateData.phone = data.phone ? data.phone.trim() : null;

  if (data.newPassword) {
    updateData.passwordHash = await hashPassword(data.newPassword);
  }

  const updated = await prisma.user.update({
    where: { id: data.id },
    data: updateData,
  });

  return NextResponse.json({
    ok: true,
    message: `Profile ${updated.email || updated.id} updated successfully.`,
    user: {
      id: updated.id,
      email: updated.email,
      status: updated.status,
      officeLocation: updated.officeLocation,
    },
  });
});

export const DELETE = handleRoute(async (request: Request) => {
  const actor = await requireUser(request);
  if (actor.role !== 'ADMIN') {
    throw new ApiError('forbidden', 'Only administrators can delete profiles.');
  }

  const data = await parseJson(request, deleteUserSchema);
  if (data.id === actor.id) {
    throw new ApiError('forbidden', 'You cannot delete your own administrator account.');
  }

  const user = await prisma.user.findUnique({ where: { id: data.id } });
  if (!user) {
    throw new ApiError('not_found', 'Profile not found.');
  }

  await prisma.user.delete({ where: { id: data.id } });

  return NextResponse.json({
    ok: true,
    message: `Profile ${user.email || user.id} deleted successfully.`,
  });
});
