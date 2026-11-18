import { Router } from 'express';
import { prisma } from '@/lib/db';
import { ApiError, asyncHandler } from '@/lib/http';
import { requireAuth, requireAdmin, getUserFromRequest } from '@/lib/current-user';
import { getPlanCatalog } from '@/lib/plans';
import { grantPremium } from '@/lib/subscription';

export const subscriptionRouter = Router();

// GET /api/subscription
subscriptionRouter.get(
  '/subscription',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const [sub, catalog, invoices] = await Promise.all([
      prisma.subscription.findUnique({ where: { userId: user.id } }),
      getPlanCatalog().catch(() => null),
      prisma.invoice.findMany({
        where: { userId: user.id },
        orderBy: { issuedAt: 'desc' },
        take: 20,
      }),
    ]);

    res.json({
      subscription: sub,
      catalog,
      invoices,
    });
  })
);

// GET /api/entitlement
subscriptionRouter.get(
  '/entitlement',
  asyncHandler(async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!user) {
      res.json({ isPremium: false, role: 'GUEST' });
      return;
    }

    const sub = await prisma.subscription.findUnique({
      where: { userId: user.id },
    });

    const isPremium =
      sub !== null &&
      ['ACTIVE', 'TRIALING'].includes(sub.status) &&
      sub.currentPeriodEnd !== null &&
      sub.currentPeriodEnd >= new Date();

    res.json({
      isPremium,
      role: user.role,
      plan: sub?.period ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    });
  })
);

// POST /api/admin/subscription/grant
subscriptionRouter.post(
  '/admin/subscription/grant',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId, period, note } = req.body;
    if (!userId) throw new ApiError('invalid_request', 'Missing user ID');

    const subscription = await grantPremium({
      userId,
      period: period === 'MONTHLY' ? 'MONTHLY' : 'ANNUAL',
      grantedByUserId: req.user!.id,
      note: note || 'Granted by Admin',
    });

    res.json({
      ok: true,
      entitlement: {
        isPremium: true,
        period: subscription.period,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
    });
  })
);
