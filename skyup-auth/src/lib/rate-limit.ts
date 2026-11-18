import { prisma } from './db';
import { ApiError } from './http';
import { redis, tryRedis } from './redis';

export interface RateLimitRule {
  /** Distinct namespace, e.g. "login" or "otp:send". */
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RULES = {
  login: { name: 'login', limit: 10, windowSeconds: 900 },
  register: { name: 'register', limit: 5, windowSeconds: 3600 },
  otpSend: { name: 'otp:send', limit: 5, windowSeconds: 900 },
  otpVerify: { name: 'otp:verify', limit: 10, windowSeconds: 900 },
  passwordForgot: { name: 'password:forgot', limit: 5, windowSeconds: 3600 },
} satisfies Record<string, RateLimitRule>;

function tooMany(rule: RateLimitRule): never {
  throw new ApiError(
    'rate_limited',
    'Too many attempts. Please wait and try again.',
    undefined,
    { 'Retry-After': String(rule.windowSeconds) },
  );
}

/**
 * Counts an attempt against a fixed window.
 *
 * Redis is the primary store: this runs on effectively every request, and a
 * Postgres write per request is load that buys nothing durable. INCR plus a
 * first-write EXPIRE is a single round trip and needs no row, no vacuum and no
 * cleanup job.
 *
 * Postgres remains the fallback so limits still apply if Redis is unavailable —
 * degrading to "slower but enforced" rather than "unlimited".
 */
export async function consumeRateLimit(
  rule: RateLimitRule,
  identifier: string,
): Promise<void> {
  const key = `rl:${rule.name}:${identifier}`;

  if (redis) {
    const result = await tryRedis(async (client) => {
      const pipeline = client.multi();
      pipeline.incr(key);
      // NX so the window starts at the first hit and is not extended by later
      // ones — otherwise a steady stream of requests would never let it expire.
      pipeline.expire(key, rule.windowSeconds, 'NX');
      const replies = await pipeline.exec();
      return Number(replies?.[0]?.[1] ?? 0);
    });

    if (result !== null) {
      if (result > rule.limit) tooMany(rule);
      return;
    }
  }

  await consumeInPostgres(rule, identifier, key);
}

/** Atomic fixed-window counter in Postgres, used when Redis is unreachable. */
async function consumeInPostgres(
  rule: RateLimitRule,
  identifier: string,
  key: string,
): Promise<void> {
  const windowStart = new Date(Date.now() - rule.windowSeconds * 1000);

  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO rate_limits (key, count, "windowStart")
    VALUES (${key}, 1, NOW())
    ON CONFLICT (key) DO UPDATE
      SET count = CASE
            WHEN rate_limits."windowStart" < ${windowStart} THEN 1
            ELSE rate_limits.count + 1
          END,
          "windowStart" = CASE
            WHEN rate_limits."windowStart" < ${windowStart} THEN NOW()
            ELSE rate_limits."windowStart"
          END
    RETURNING count
  `;

  if (Number(rows[0]?.count ?? 1) > rule.limit) tooMany(rule);
}

/** Clears the counter after a legitimate success, so honest users are not penalised. */
export async function resetRateLimit(rule: RateLimitRule, identifier: string): Promise<void> {
  const key = `rl:${rule.name}:${identifier}`;
  await tryRedis((client) => client.del(key));
  await prisma.rateLimit.deleteMany({ where: { key } });
}
