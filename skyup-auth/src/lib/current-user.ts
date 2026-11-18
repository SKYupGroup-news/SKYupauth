import { cookies } from 'next/headers';
import { prisma } from './db';
import { ACCESS_COOKIE } from './session';
import { ApiError } from './http';
import { avatarPublicUrl } from './avatar-store';
import { verifyAccessToken } from './tokens';
import { readCachedSession, writeCachedSession } from './session-cache';
import type { User } from '@/generated/prisma';

/** Public shape — never expose passwordHash to a client. */
/**
 * The image a client should actually render: an external URL if the profile has
 * one, otherwise our own endpoint when a picture was uploaded, else null so the
 * UI can fall back to initials rather than a broken <img>.
 */
export function avatarSrcFor(user: {
  id: string;
  avatarUrl: string | null;
  avatarUpdatedAt: Date | null;
  avatarMimeType?: string;
}): string | null {
  if (user.avatarUrl) return user.avatarUrl;
  if (user.avatarUpdatedAt) {
    // Points at the CDN when one is configured, so image traffic never reaches
    // this service at all.
    return avatarPublicUrl(user.id, user.avatarUpdatedAt, user.avatarMimeType);
  }
  return null;
}

export type PublicUser = Pick<
  User,
  | 'id'
  | 'email'
  | 'phone'
  | 'displayName'
  | 'avatarUrl'
  | 'role'
  | 'createdAt'
  | 'bio'
  | 'dateOfBirth'
  | 'locale'
  | 'timezone'
  | 'country'
  | 'state'
  | 'city'
  | 'officeLocation'
  | 'contactPhone'
  | 'digestFrequency'
  | 'preferredTopics'
  | 'notifyBreakingNews'
  | 'notifyNewsletter'
  | 'notifyProductNews'
> & {
  emailVerified: boolean;
  phoneVerified: boolean;
  avatarSrc: string | null;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    createdAt: user.createdAt,
    bio: user.bio,
    dateOfBirth: user.dateOfBirth,
    locale: user.locale,
    timezone: user.timezone,
    country: user.country,
    state: user.state,
    city: user.city,
    officeLocation: user.officeLocation,
    contactPhone: user.contactPhone,
    digestFrequency: user.digestFrequency,
    preferredTopics: user.preferredTopics,
    notifyBreakingNews: user.notifyBreakingNews,
    notifyNewsletter: user.notifyNewsletter,
    notifyProductNews: user.notifyProductNews,
    emailVerified: user.emailVerifiedAt !== null,
    phoneVerified: user.phoneVerifiedAt !== null,
    avatarSrc: avatarSrcFor(user),
  };
}

function bearerToken(request?: Request): string | null {
  const header = request?.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * Resolves the caller from an Authorization header (API/mobile clients) or the
 * access-token cookie (browser). Returns null instead of throwing so callers
 * can decide between "optional" and "required" behaviour.
 *
 * The session row is re-checked on every call, so a revoked session stops
 * working immediately rather than lingering until the access token expires.
 */
export async function getCurrentUser(request?: Request): Promise<PublicUser | null> {
  const token = bearerToken(request) ?? (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  // The token is already proven authentic by its signature; this lookup only
  // answers "is the session still live", which is exactly what caches well.
  const cached = await readCachedSession(claims.sid);
  if (cached) return cached;

  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.user.status !== 'ACTIVE') return null;

  const publicUser = toPublicUser(session.user);
  await writeCachedSession(claims.sid, publicUser);
  return publicUser;
}

export async function requireUser(request?: Request): Promise<PublicUser> {
  const user = await getCurrentUser(request);
  if (!user) throw new ApiError('unauthorized', 'You must be signed in to do that.');
  return user;
}
