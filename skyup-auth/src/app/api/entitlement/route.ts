import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/current-user';
import { handleRoute } from '@/lib/http';
import { getEntitlement } from '@/lib/subscription';

/**
 * Lightweight gate for the reader-facing app: "may this person open a premium
 * story?" Returns a free entitlement for signed-out visitors rather than 401,
 * so the feed can render for guests without special-casing the error.
 */
export const GET = handleRoute(async (request: Request) => {
  const user = await getCurrentUser(request);

  if (!user) {
    return NextResponse.json({
      authenticated: false,
      entitlement: { isPremium: false, status: 'NONE' },
    });
  }

  return NextResponse.json({
    authenticated: true,
    userId: user.id,
    entitlement: await getEntitlement(user.id),
  });
});
