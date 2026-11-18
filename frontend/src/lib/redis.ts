import Redis from 'ioredis';
import { env, isProduction } from './env';

/**
 * Redis carries the two highest-volume operations: rate-limit counters and
 * resolved sessions.
 *
 * Every call site treats it as a cache, never as a source of truth. If Redis is
 * down the app falls back to Postgres and keeps serving — a cache outage must
 * never become an authentication outage.
 */
const globalForRedis = globalThis as unknown as { redis?: Redis | null };

function createClient(): Redis | null {
  if (!env.REDIS_URL) return null;

  const client = new Redis(env.REDIS_URL, {
    // Fail fast and fall through to Postgres rather than holding a request open.
    connectTimeout: 1000,
    commandTimeout: 1000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  client.on('error', (error) => {
    // Logged once per failure, not per request; ioredis reconnects on its own.
    if (!isProduction) console.warn('[redis]', error.message);
  });

  return client;
}

export const redis: Redis | null = globalForRedis.redis ?? createClient();

if (!isProduction) globalForRedis.redis = redis;

/** True only when a command just succeeded, not merely when a client exists. */
export async function redisHealthy(): Promise<boolean> {
  if (!redis) return false;
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Runs a Redis command, returning null on any failure so callers can fall back
 * without every one of them writing its own try/catch.
 */
export async function tryRedis<T>(fn: (client: Redis) => Promise<T>): Promise<T | null> {
  if (!redis) return null;
  try {
    return await fn(redis);
  } catch {
    return null;
  }
}
