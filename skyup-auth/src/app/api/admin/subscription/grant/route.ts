import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute, parseJson } from '@/lib/http';
import { entitlementFrom, grantPremium } from '@/lib/subscription';
import { grantSubscriptionSchema } from '@/lib/validation';

/** Complimentary Premium, for support cases and press accounts. */
export const POST = handleRoute(async (request: Request) => {
  const actor = await requireUser(request);

  if (actor.role !== 'ADMIN') {
    throw new ApiError('forbidden', 'Only administrators can grant subscriptions.');
  }

  const { userId, period, note } = await parseJson(request, grantSubscriptionSchema);

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new ApiError('not_found', 'No such reader.');

  const subscription = await grantPremium({
    userId,
    period,
    grantedByUserId: actor.id,
    note,
  });

  return NextResponse.json({
    ok: true,
    userId,
    entitlement: entitlementFrom(subscription),
  });
});
