import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/current-user';
import { ApiError, handleRoute } from '@/lib/http';
import { cancelPremium, entitlementFrom } from '@/lib/subscription';

export const POST = handleRoute(async (request: Request) => {
  const user = await requireUser(request);
  const subscription = await cancelPremium(user.id);

  if (!subscription) {
    throw new ApiError('not_found', 'You do not have an active subscription.');
  }

  return NextResponse.json({
    ok: true,
    message:
      'Your subscription will not renew. You keep Premium access until the end of the period you paid for.',
    entitlement: entitlementFrom(subscription),
  });
});
