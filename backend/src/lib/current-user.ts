import type { Request, Response, NextFunction } from 'express';
import { prisma } from './db';
import { ACCESS_COOKIE } from './session';
import { ApiError } from './http';
import { avatarPublicUrl } from './avatar-store';
import { verifyAccessToken } from './tokens';
import { readCachedSession, writeCachedSession } from './session-cache';
import type { Role, User } from '@/generated/prisma';

export interface AuthenticatedRequest extends Request {
  user?: PublicUser;
}

export function avatarSrcFor(user: {
  id: string;
  avatarUrl: string | null;
  avatarUpdatedAt: Date | null;
  avatarMimeType?: string;
}): string | null {
  if (user.avatarUrl) return user.avatarUrl;
  if (user.avatarUpdatedAt) {
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

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

export async function getUserFromRequest(req: Request): Promise<PublicUser | null> {
  const token = bearerToken(req) ?? req.cookies?.[ACCESS_COOKIE] ?? null;
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  const cached = await readCachedSession(claims.sid);
  if (cached) {
    return cached;
  }

  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.user.status !== 'ACTIVE') {
    return null;
  }

  const publicUser = toPublicUser(session.user);
  await writeCachedSession(session.id, publicUser);

  return publicUser;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      throw new ApiError('unauthorized', 'You must be signed in to perform this action.');
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: Role[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        const user = await getUserFromRequest(req);
        if (!user) {
          throw new ApiError('unauthorized', 'You must be signed in.');
        }
        req.user = user;
      }
      if (!roles.includes(req.user.role as Role)) {
        throw new ApiError('forbidden', 'You do not have permission to access this resource.');
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireAdmin = requireRole('ADMIN');
