import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ApiError, handleRoute } from '@/lib/http';
import { REFRESH_COOKIE, clearAuthCookies, rotateSession, setAuthCookies } from '@/lib/session';

export const POST = handleRoute(async (request: Request) => {
  // Browsers send the httpOnly cookie; native clients may post the token instead.
  const fromCookie = (await cookies()).get(REFRESH_COOKIE)?.value;
  let refreshToken = fromCookie ?? null;

  if (!refreshToken) {
    const body = await request.json().catch(() => null);
    if (body && typeof body === 'object' && 'refreshToken' in body) {
      const value = (body as { refreshToken?: unknown }).refreshToken;
      if (typeof value === 'string') refreshToken = value;
    }
  }

  if (!refreshToken) {
    throw new ApiError('unauthorized', 'No refresh token supplied.');
  }

  try {
    const tokens = await rotateSession(refreshToken, request);
    return setAuthCookies(
      NextResponse.json({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.accessTokenExpiresIn,
      }),
      tokens,
    );
  } catch (error) {
    // A rejected refresh means the cookie is worthless — clear it so the
    // browser stops replaying it on every subsequent request.
    if (error instanceof ApiError) {
      return clearAuthCookies(
        NextResponse.json(
          { error: { code: error.code, message: error.message } },
          { status: error.code === 'forbidden' ? 403 : 401 },
        ),
      );
    }
    throw error;
  }
});
