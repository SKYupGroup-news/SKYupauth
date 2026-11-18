import { prisma } from '@/lib/db';

/**
 * Clears every table the suite writes to, in dependency order.
 *
 * Tests share one database and run sequentially, so each starts from a known
 * empty state rather than depending on what ran before it.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      account_actions, notifications, comment_likes, comments, article_likes,
      article_stats, user_avatars, invoices, subscriptions, sessions,
      oauth_accounts, verification_tokens, otp_codes, rate_limits, users
    RESTART IDENTITY CASCADE
  `);
}

let counter = 0;

export async function makeUser(
  overrides: Partial<{
    email: string;
    displayName: string;
    role: 'READER' | 'EDITOR' | 'ADMIN';
    status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
    passwordHash: string;
  }> = {},
) {
  counter += 1;
  return prisma.user.create({
    data: {
      email: overrides.email ?? `reader${counter}@test.local`,
      displayName: overrides.displayName ?? `Reader ${counter}`,
      role: overrides.role ?? 'READER',
      status: overrides.status ?? 'ACTIVE',
      passwordHash: overrides.passwordHash ?? null,
    },
  });
}

/** A bare Request, for helpers that read headers off one. */
export function fakeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3100/test', { headers });
}
