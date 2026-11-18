import { env } from './env';
import { redis, tryRedis } from './redis';
import type { PublicUser } from './current-user';

/**
 * Cache of resolved sessions.
 *
 * Resolving a session is the single highest-volume query in the service: it
 * runs on every authenticated request, joins to `users`, and almost always
 * returns the same answer it returned a second ago.
 *
 * Revocation does NOT wait for the TTL. Signing out, a password reset and a
 * suspension all drop the entry immediately, so the TTL is only a backstop for
 * changes made outside the app (a direct database edit, say).
 */
const key = (sessionId: string) => `sess:${sessionId}`;
/** Set of a reader's live session ids, so "sign out everywhere" can find them. */
const userKey = (userId: string) => `usess:${userId}`;

export interface CachedSession {
  user: PublicUser;
}

export async function readCachedSession(sessionId: string): Promise<PublicUser | null> {
  const raw = await tryRedis((client) => client.get(key(sessionId)));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CachedSession;
    // JSON has no Date type; these come back as strings and callers expect Dates.
    return {
      ...parsed.user,
      createdAt: new Date(parsed.user.createdAt),
      dateOfBirth: parsed.user.dateOfBirth ? new Date(parsed.user.dateOfBirth) : null,
    };
  } catch {
    return null;
  }
}

export async function writeCachedSession(
  sessionId: string,
  user: PublicUser,
): Promise<void> {
  if (!redis) return;

  await tryRedis(async (client) => {
    const ttl = env.SESSION_CACHE_TTL_SECONDS;
    const pipeline = client.multi();
    pipeline.set(key(sessionId), JSON.stringify({ user }), 'EX', ttl);
    pipeline.sadd(userKey(user.id), sessionId);
    // The index outlives any single entry, but must not live forever either.
    pipeline.expire(userKey(user.id), env.REFRESH_TOKEN_TTL_SECONDS);
    return pipeline.exec();
  });
}

/** Drops one session immediately — used on sign-out. */
export async function dropCachedSession(sessionId: string): Promise<void> {
  await tryRedis((client) => client.del(key(sessionId)));
}

/**
 * Drops every cached session for a reader. Called wherever sessions are revoked
 * in bulk: password change, password reset, and suspension.
 */
export async function dropCachedSessionsForUser(userId: string): Promise<void> {
  await tryRedis(async (client) => {
    const ids = await client.smembers(userKey(userId));
    const pipeline = client.multi();
    for (const id of ids) pipeline.del(key(id));
    pipeline.del(userKey(userId));
    return pipeline.exec();
  });
}
