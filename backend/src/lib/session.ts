import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { prisma } from './db';
import { env, isProduction } from './env';
import { ApiError } from './http';
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

export interface RequestMeta {
  ip: string;
  userAgent?: string | null;
}

async function issueForFamily(
  user: Pick<User, 'id' | 'role'>,
  familyId: string,
  meta: RequestMeta,
): Promise<IssuedTokens> {
  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      familyId,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
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
export function createSession(user: Pick<User, 'id' | 'role'>, meta: RequestMeta) {
  return issueForFamily(user, randomUUID(), meta);
}

/**
 * Exchanges a refresh token for a new pair.
 */
export async function rotateSession(rawToken: string, meta: RequestMeta): Promise<IssuedTokens> {
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

  const issued = await issueForFamily(existing.user, existing.familyId, meta);

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

  if (session) await dropCachedSession(session.id);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await dropCachedSessionsForUser(userId);
}

export function setAuthCookies(res: Response, tokens: IssuedTokens): void {
  const base = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };

  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    path: '/',
    maxAge: tokens.accessTokenExpiresIn * 1000,
  });

  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    expires: tokens.refreshTokenExpiresAt,
  });
}

export function clearAuthCookies(res: Response): void {
  const domain = env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {};
  res.clearCookie(ACCESS_COOKIE, { path: '/', ...domain });
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, ...domain });
}
