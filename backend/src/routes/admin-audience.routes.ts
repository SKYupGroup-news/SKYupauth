import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError, asyncHandler } from '@/lib/http';
import { requireAdmin, avatarSrcFor, type AuthenticatedRequest } from '@/lib/current-user';
import { premiumSubscriptionWhere, entitlementFrom } from '@/lib/subscription';
import { AUTHOR_SELECT, toPublicAuthor } from '@/lib/engagement';
import { revokeAllSessions } from '@/lib/session';
import { dropCachedSessionsForUser } from '@/lib/session-cache';
import type { Prisma } from '@/generated/prisma';

export const AUDIENCE_FILTERS = [
  'all',
  'premium',
  'free',
  'cancelling',
  'expiring',
] as const;

export type AudienceFilter = (typeof AUDIENCE_FILTERS)[number];

const PAGE_SIZE = 25;
const NO_LOCATION = '__none__';

const premiumWhere = premiumSubscriptionWhere;

export function endOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

function expiringWhere(now: Date): Prisma.SubscriptionWhereInput {
  return {
    ...premiumWhere(now),
    currentPeriodEnd: { gt: now, lte: endOfMonth(now) },
  };
}

function filterToWhere(filter: AudienceFilter, now: Date): Prisma.UserWhereInput {
  switch (filter) {
    case 'premium':
      return { subscription: { is: premiumWhere(now) } };
    case 'cancelling':
      return { subscription: { is: { ...premiumWhere(now), cancelAtPeriodEnd: true } } };
    case 'expiring':
      return { subscription: { is: expiringWhere(now) } };
    case 'free':
      return { NOT: { subscription: { is: premiumWhere(now) } } };
    default:
      return {};
  }
}

export const adminAudienceRouter = Router();

// GET /api/admin/audience
adminAudienceRouter.get(
  '/audience',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const filterParam = typeof req.query.filter === 'string' ? req.query.filter : 'all';
    const filter: AudienceFilter = (AUDIENCE_FILTERS as readonly string[]).includes(filterParam)
      ? (filterParam as AudienceFilter)
      : 'all';
    const page = Math.max(1, Number(req.query.page) || 1);

    const country = typeof req.query.country === 'string' ? req.query.country.trim() : '';
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';

    const now = new Date();

    const search: Prisma.UserWhereInput = query
      ? {
          OR: [
            { email: { contains: query, mode: 'insensitive' } },
            { displayName: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query } },
            { city: { contains: query, mode: 'insensitive' } },
            { state: { contains: query, mode: 'insensitive' } },
            { country: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {};

    const locationWhere: Prisma.UserWhereInput = {
      ...(country ? (country === NO_LOCATION ? { country: null } : { country }) : {}),
      ...(state ? (state === NO_LOCATION ? { state: null } : { state }) : {}),
      ...(city ? (city === NO_LOCATION ? { city: null } : { city }) : {}),
    };

    const where: Prisma.UserWhereInput = {
      AND: [search, filterToWhere(filter, now), locationWhere],
    };

    const facetWhere: Prisma.UserWhereInput = { AND: [search, filterToWhere(filter, now)] };

    const [
      total,
      rows,
      totalReaders,
      premiumCount,
      cancellingCount,
      expiringCount,
      paidAgg,
      locationRows,
    ] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        include: { subscription: true },
        orderBy:
          filter === 'expiring'
            ? { subscription: { currentPeriodEnd: 'asc' } }
            : { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.user.count(),
      prisma.user.count({ where: { subscription: { is: { status: { in: ['ACTIVE', 'TRIALING'] }, currentPeriodEnd: { gte: now } } } } }),
      prisma.user.count({
        where: { subscription: { is: { status: { in: ['ACTIVE', 'TRIALING'] }, currentPeriodEnd: { gte: now }, cancelAtPeriodEnd: true } } },
      }),
      prisma.user.count({
        where: { subscription: { is: { status: { in: ['ACTIVE', 'TRIALING'] }, currentPeriodEnd: { gte: now, lte: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999) } } } },
      }),
      prisma.invoice.groupBy({
        by: ['currency'],
        _sum: { amount: true },
        where: { status: 'PAID' },
      }),
      prisma.user.groupBy({
        by: ['country', 'state', 'city'],
        where: facetWhere,
        _count: { _all: true },
      }),
    ]);

    const regionMap = new Map<
      string,
      {
        value: string;
        label: string;
        count: number;
        states: Map<string, { value: string; label: string; count: number; cities: Map<string, number> }>;
        cities: Map<string, number>;
      }
    >();

    for (const row of locationRows) {
      const value = row.country ?? NO_LOCATION;
      const label = row.country ?? 'No location set';
      const entry =
        regionMap.get(value) ?? {
          value,
          label,
          count: 0,
          states: new Map(),
          cities: new Map(),
        };

      entry.count += row._count._all;

      const stateValue = row.state ?? NO_LOCATION;
      const stateLabel = row.state ?? 'No state set';
      const stateEntry = entry.states.get(stateValue) ?? {
        value: stateValue,
        label: stateLabel,
        count: 0,
        cities: new Map(),
      };
      stateEntry.count += row._count._all;

      const cityValue = row.city ?? NO_LOCATION;
      stateEntry.cities.set(cityValue, (stateEntry.cities.get(cityValue) ?? 0) + row._count._all);
      entry.states.set(stateValue, stateEntry);

      entry.cities.set(cityValue, (entry.cities.get(cityValue) ?? 0) + row._count._all);
      regionMap.set(value, entry);
    }

    const regions = [...regionMap.values()]
      .sort((a, b) =>
        a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
      )
      .map((entry) => ({
        value: entry.value,
        label: entry.label,
        count: entry.count,
        states: [...entry.states.values()]
          .map((s) => ({
            value: s.value,
            label: s.label,
            count: s.count,
            cities: [...s.cities.entries()]
              .map(([cVal, cCount]) => ({
                value: cVal,
                label: cVal === NO_LOCATION ? 'No city set' : cVal,
                count: cCount,
              }))
              .sort((a, b) =>
                a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
              ),
          }))
          .sort((a, b) =>
            a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
          ),
        cities: [...entry.cities.entries()]
          .map(([value, count]) => ({
            value,
            label: value === NO_LOCATION ? 'No city set' : value,
            count,
          }))
          .sort((a, b) =>
            a.value === NO_LOCATION ? 1 : b.value === NO_LOCATION ? -1 : b.count - a.count,
          ),
      }));

    const readers = rows.map((reader) => {
      const sub = reader.subscription;
      const isPremium =
        sub !== null &&
        ['ACTIVE', 'TRIALING'].includes(sub.status) &&
        sub.currentPeriodEnd !== null &&
        sub.currentPeriodEnd >= now;

      let daysRemaining: number | null = null;
      if (isPremium && sub?.currentPeriodEnd) {
        const diffMs = sub.currentPeriodEnd.getTime() - now.getTime();
        daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      }

      return {
        id: reader.id,
        name: reader.displayName,
        email: reader.email,
        phone: reader.phone,
        avatarSrc: reader.avatarUrl,
        role: reader.role,
        status: reader.status,
        country: reader.country,
        state: reader.state,
        city: reader.city,
        joinedAt: reader.createdAt.toISOString(),
        emailVerified: reader.emailVerifiedAt !== null,
        isPremium,
        plan: sub?.period ?? null,
        subscriptionStatus: sub?.status ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        daysRemaining,
      };
    });

    const collected = paidAgg.map((row) => ({
      currency: row.currency,
      amountMinor: row._sum.amount ?? 0,
    }));

    res.json({
      summary: {
        totalReaders,
        premium: premiumCount,
        cancelling: cancellingCount,
        expiringThisMonth: expiringCount,
        free: Math.max(0, totalReaders - premiumCount),
        collected,
        monthEndsOn: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString(),
      },
      regions,
      activeLocation: { country, state, city },
      filter,
      page,
      total,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      pageSize: PAGE_SIZE,
      readers,
    });
  })
);

// GET /api/admin/audience/:userId
adminAudienceRouter.get(
  '/audience/:userId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const now = new Date();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscription: true,
        oauthAccounts: { select: { provider: true, createdAt: true } },
        invoices: { orderBy: { issuedAt: 'desc' }, take: 100 },
        // Sessions double as the login history: one row per sign-in.
        sessions: { orderBy: { createdAt: 'desc' }, take: 25 },
      },
    });

    if (!user) throw new ApiError('not_found', 'No such reader.');

    const entitlement = entitlementFrom(user.subscription);

    // Engagement is counted separately so the reader row itself stays light.
    const [likeCount, commentCount, likesReceived, recentComments, unreadNotifications] =
      await Promise.all([
        prisma.articleLike.count({ where: { userId } }),
        prisma.comment.count({ where: { userId, deletedAt: null } }),
        prisma.commentLike.count({ where: { comment: { userId } } }),
        prisma.comment.findMany({
          where: { userId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { _count: { select: { likes: true, replies: true } } },
        }),
        prisma.notification.count({ where: { userId, readAt: null } }),
      ]);

    // Append-only staff audit for this account, newest first.
    const accountActions = await prisma.accountAction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { actor: { select: AUTHOR_SELECT } },
    });

    const lifetimeMinor = user.invoices
      .filter((invoice) => invoice.status === 'PAID')
      .reduce((sum, invoice) => sum + invoice.amount, 0);

    res.json({
      reader: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerifiedAt !== null,
        phone: user.phone,
        phoneVerified: user.phoneVerifiedAt !== null,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        avatarSrc: avatarSrcFor(user),
        bio: user.bio,
        dateOfBirth: user.dateOfBirth,
        locale: user.locale,
        timezone: user.timezone,
        country: user.country,
        state: user.state,
        city: user.city,
        contactPhone: user.contactPhone,
        digestFrequency: user.digestFrequency,
        preferredTopics: user.preferredTopics,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        hasPassword: user.passwordHash !== null,
        notifications: {
          breakingNews: user.notifyBreakingNews,
          newsletter: user.notifyNewsletter,
          productNews: user.notifyProductNews,
        },
      },
      entitlement,
      subscription: user.subscription
        ? {
            planKey: user.subscription.planKey,
            status: user.subscription.status,
            period: user.subscription.period,
            currentPeriodStart: user.subscription.currentPeriodStart,
            currentPeriodEnd: user.subscription.currentPeriodEnd,
            cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
            canceledAt: user.subscription.canceledAt,
            grantedByUserId: user.subscription.grantedByUserId,
            grantNote: user.subscription.grantNote,
            createdAt: user.subscription.createdAt,
          }
        : null,
      signIns: {
        password: user.passwordHash !== null,
        phoneOtp: user.phoneVerifiedAt !== null,
        oauth: user.oauthAccounts.map((account) => ({
          provider: account.provider,
          linkedAt: account.createdAt,
        })),
      },
      billing: {
        lifetimeValue: lifetimeMinor / 100,
        currency: user.invoices[0]?.currency ?? 'INR',
        paidCount: user.invoices.filter((invoice) => invoice.status === 'PAID').length,
        invoices: user.invoices.map((invoice) => ({
          id: invoice.id,
          amount: invoice.amount / 100,
          originalAmount: invoice.originalAmount ? invoice.originalAmount / 100 : null,
          currency: invoice.currency,
          status: invoice.status,
          period: invoice.period,
          promoCode: invoice.promoCode,
          discountPercent: invoice.discountPercent,
          paymentMethod: invoice.paymentMethod,
          failureReason: invoice.failureReason,
          issuedAt: invoice.issuedAt,
          paidAt: invoice.paidAt,
        })),
      },
      activity: user.sessions.map((session) => ({
        id: session.id,
        signedInAt: session.createdAt,
        expiresAt: session.expiresAt,
        userAgent: session.userAgent,
        ip: session.ip,
        active: session.revokedAt === null && session.expiresAt > now,
        revokedAt: session.revokedAt,
        rotatedAt: session.rotatedAt,
      })),
      accountActions: accountActions.map((entry) => ({
        id: entry.id,
        type: entry.type,
        reason: entry.reason,
        actor: toPublicAuthor(entry.actor),
        createdAt: entry.createdAt,
      })),
      engagement: {
        articleLikes: likeCount,
        comments: commentCount,
        likesReceived,
        unreadNotifications,
        recentComments: recentComments.map((comment) => ({
          id: comment.id,
          articleId: comment.articleId,
          articleTitle: comment.articleTitle,
          body: comment.body,
          isReply: comment.parentId !== null,
          likeCount: comment._count.likes,
          replyCount: comment._count.replies,
          createdAt: comment.createdAt,
        })),
      },
      activeSessionCount: user.sessions.filter(
        (session) => session.revokedAt === null && session.expiresAt > now,
      ).length,
    });
  })
);

const statusSchema = z.object({
  action: z.enum(['SUSPEND', 'REINSTATE']),
  reason: z
    .string()
    .trim()
    .min(5, 'Give a reason of at least 5 characters.')
    .max(500, 'Reasons are limited to 500 characters.'),
});

// POST /api/admin/audience/:userId/status
adminAudienceRouter.post(
  '/audience/:userId/status',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const actor = (req as AuthenticatedRequest).user!;
    const { userId } = req.params;
    const { action, reason } = statusSchema.parse(req.body);

    if (userId === actor.id) {
      throw new ApiError('invalid_request', 'You cannot change your own account status.');
    }

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new ApiError('not_found', 'No such reader.');

    const nextStatus = action === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE';
    if (target.status === nextStatus) {
      throw new ApiError(
        'conflict',
        action === 'SUSPEND'
          ? 'That account is already suspended.'
          : 'That account is already active.'
      );
    }

    const [updated, entry] = await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { status: nextStatus } }),
      prisma.accountAction.create({
        data: { userId, actorId: actor.id, type: action, reason },
        include: { actor: { select: AUTHOR_SELECT } },
      }),
    ]);

    if (action === 'SUSPEND') {
      await revokeAllSessions(userId);
    } else {
      await dropCachedSessionsForUser(userId);
    }

    res.json({
      ok: true,
      userId,
      status: updated.status,
      action: {
        id: entry.id,
        type: entry.type,
        reason: entry.reason,
        actor: toPublicAuthor(entry.actor),
        createdAt: entry.createdAt,
      },
    });
  })
);
