import { randomUUID } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { prisma } from './db';
import { env, isProduction } from './env';
import { ApiError, clientIp } from './http';
import { generateOpaqueToken, hashToken, signAccessToken } from './tokens';
import { dropCachedSession, dropCachedSessionsForUser } from './session-cache';
import type { Role, User } from '@/generated/prisma';

export const ACCESS_COOKIE = 'skyup_access';
export const REFRESH_COOKIE = 'skyup_refresh';

/** Scoped so browsers only transmit the refresh token to the endpoints that need it. */
const REFRESH_COOKIE_PATH = '/api/auth';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: Date;
  sessionId: string;
}

function requestMeta(request: Request) {
  return {
    userAgent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
    ip: clientIp(request),
  };
}

async function issueForFamily(
  user: Pick<User, 'id' | 'role'>,
  familyId: string,
  request: Request,
): Promise<IssuedTokens> {
  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      familyId,
      expiresAt,
      ...requestMeta(request),
    },
  });

  const accessToken = await signAccessToken({
    userId: user.id,
    sessionId: session.id,
    role: user.role as Role,
  });

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenExpiresAt: expiresAt,
    sessionId: session.id,
  };
}

/** Starts a brand-new token family — used on every fresh sign-in. */
export function createSession(user: Pick<User, 'id' | 'role'>, request: Request) {
  return issueForFamily(user, randomUUID(), request);
}

/**
 * Exchanges a refresh token for a new pair.
 *
 * Rotation is single-use. If a token that was already rotated (or explicitly
 * revoked) is presented again, we treat it as a stolen-token replay and revoke
 * every live session in that family, forcing a real re-authentication.
 */
export async function rotateSession(rawToken: string, request: Request): Promise<IssuedTokens> {
  const existing = await prisma.session.findUnique({
    where: { refreshTokenHash: hashToken(rawToken) },
    include: { user: true },
  });

  if (!existing) {
    throw new ApiError('unauthorized', 'Invalid refresh token.');
  }

  if (existing.rotatedAt || existing.revokedAt) {
    await prisma.session.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Replay detected: evict the whole family from cache, not just the database.
    await dropCachedSessionsForUser(existing.userId);
    throw new ApiError(
      'unauthorized',
      'Refresh token reuse detected. All sessions have been signed out.',
    );
  }

  if (existing.expiresAt <= new Date()) {
    throw new ApiError('unauthorized', 'Refresh token has expired.');
  }

  if (existing.user.status !== 'ACTIVE') {
    await prisma.session.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new ApiError('forbidden', 'This account is no longer active.');
  }

  const issued = await issueForFamily(existing.user, existing.familyId, request);

  await prisma.session.update({
    where: { id: existing.id },
    data: { rotatedAt: new Date(), replacedById: issued.sessionId },
  });

  await dropCachedSession(existing.id);

  return issued;
}

export async function revokeSessionByToken(rawToken: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: hashToken(rawToken) },
    select: { id: true },
  });

  await prisma.session.updateMany({
    where: { refreshTokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });

  // Immediately, not at TTL: a signed-out session must stop working now.
  if (session) await dropCachedSession(session.id);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  // Covers password change, password reset and suspension — all of which must
  // evict every device at once rather than after the cache expires.
  await dropCachedSessionsForUser(userId);
}

export function setAuthCookies(response: NextResponse, tokens: IssuedTokens): NextResponse {
  const base = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    // Different ports on localhost are already same-site, so this is only
    // needed once auth and the reader app live on separate subdomains.
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };

  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    path: '/',
    maxAge: tokens.accessTokenExpiresIn,
  });

  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    expires: tokens.refreshTokenExpiresAt,
  });

  return response;
}

export function clearAuthCookies(response: NextResponse): NextResponse {
  const domain = env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {};
  response.cookies.set(ACCESS_COOKIE, '', { path: '/', maxAge: 0, ...domain });
  response.cookies.set(REFRESH_COOKIE, '', { path: REFRESH_COOKIE_PATH, maxAge: 0, ...domain });
  return response;
}
