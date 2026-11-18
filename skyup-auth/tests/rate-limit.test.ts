import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { RULES, consumeRateLimit, resetRateLimit } from '@/lib/rate-limit';
import { resetDatabase } from './helpers';

// REDIS_URL is deliberately unset for the suite, so these exercise the Postgres
// fallback — the path that must still hold when the cache is unavailable.
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('rate limiting (Postgres fallback)', () => {
  it('allows up to the limit and blocks the next attempt', async () => {
    const rule = RULES.login;
    for (let i = 0; i < rule.limit; i += 1) {
      await expect(consumeRateLimit(rule, 'ip-a')).resolves.toBeUndefined();
    }
    await expect(consumeRateLimit(rule, 'ip-a')).rejects.toThrow(/too many/i);
  });

  it('counts each identifier separately', async () => {
    const rule = RULES.otpSend;
    for (let i = 0; i < rule.limit; i += 1) await consumeRateLimit(rule, 'phone-a');
    await expect(consumeRateLimit(rule, 'phone-a')).rejects.toThrow();

    // A different number must be unaffected by the first one's spending.
    await expect(consumeRateLimit(rule, 'phone-b')).resolves.toBeUndefined();
  });

  it('keeps namespaces apart, so login spend does not block OTP', async () => {
    for (let i = 0; i < RULES.login.limit; i += 1) await consumeRateLimit(RULES.login, 'same');
    await expect(consumeRateLimit(RULES.login, 'same')).rejects.toThrow();
    await expect(consumeRateLimit(RULES.otpSend, 'same')).resolves.toBeUndefined();
  });

  it('a success clears the counter so honest users are not penalised', async () => {
    const rule = RULES.login;
    for (let i = 0; i < rule.limit; i += 1) await consumeRateLimit(rule, 'ip-c');
    await resetRateLimit(rule, 'ip-c');
    await expect(consumeRateLimit(rule, 'ip-c')).resolves.toBeUndefined();
  });

  it('carries a Retry-After header on the rejection', async () => {
    const rule = RULES.passwordForgot;
    for (let i = 0; i < rule.limit; i += 1) await consumeRateLimit(rule, 'ip-d');

    await expect(consumeRateLimit(rule, 'ip-d')).rejects.toMatchObject({
      code: 'rate_limited',
      headers: { 'Retry-After': String(rule.windowSeconds) },
    });
  });
});
