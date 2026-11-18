import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { handleRoute } from '@/lib/http';
import { REFRESH_COOKIE, clearAuthCookies, revokeSessionByToken } from '@/lib/session';

export const POST = handleRoute(async () => {
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (refreshToken) await revokeSessionByToken(refreshToken);

  // Always report success: signing out should be idempotent.
  return clearAuthCookies(NextResponse.json({ ok: true }));
});
