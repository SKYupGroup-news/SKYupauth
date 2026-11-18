import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute } from '@/lib/http';
import { entitlementFrom, resumePremium } from '@/lib/subscription';

export const POST = handleRoute(async (request: Request) => {
  const user = await requireUser(request);
  const subscription = await resumePremium(user.id);

  if (!subscription) {
    throw new ApiError('not_found', 'You do not have a subscription to resume.');
  }

  return NextResponse.json({
    ok: true,
    message: 'Your subscription will renew as normal.',
    entitlement: entitlementFrom(subscription),
  });
});
