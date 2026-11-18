import { cookies } from 'next/headers';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

export interface PublicUser {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'READER' | 'STAFF' | 'ADMIN';
  createdAt: Date | string;
  bio: string | null;
  dateOfBirth: Date | string | null;
  locale: string | null;
  timezone: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  officeLocation: string | null;
  contactPhone: string | null;
  digestFrequency: string | null;
  preferredTopics: string[];
  notifyBreakingNews: boolean;
  notifyNewsletter: boolean;
  notifyProductNews: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  avatarSrc: string | null;
}

export function avatarSrcFor(user: {
  id: string;
  avatarUrl: string | null;
  avatarUpdatedAt: Date | null;
  avatarMimeType?: string;
}): string | null {
  if (user.avatarUrl) return user.avatarUrl;
  return null;
}

export async function getCurrentUser(request?: Request): Promise<PublicUser | null> {
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.toString();
    const authHeader = request?.headers.get('authorization');

    const headers: Record<string, string> = {};
    if (cookieHeader) headers['cookie'] = cookieHeader;
    if (authHeader) headers['authorization'] = authHeader;

    const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
      headers,
      cache: 'no-store',
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.user ?? null;
  } catch {
    return null;
  }
}

export async function requireUser(request?: Request): Promise<PublicUser> {
  const user = await getCurrentUser(request);
  if (!user) throw new Error('You must be signed in to do that.');
  return user;
}
