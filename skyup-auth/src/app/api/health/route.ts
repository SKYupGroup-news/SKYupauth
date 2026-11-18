import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redisHealthy } from '@/lib/redis';
import { percentiles } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

/**
 * Liveness and dependency check.
 *
 * Returns 503 when Postgres is unreachable, because the service genuinely
 * cannot serve. Redis being down is reported but NOT fatal: the app falls back
 * to Postgres and keeps working, so a load balancer must not pull the instance.
 */
export async function GET() {
  const started = Date.now();

  const [database, cache] = await Promise.all([
    prisma
      .$queryRaw`SELECT 1`
      .then(() => true)
      .catch(() => false),
    redisHealthy(),
  ]);

  const body = {
    status: database ? 'ok' : 'unhealthy',
    checks: {
      database: { up: database, required: true },
      // Degraded, not down: rate limits and sessions fall back to Postgres.
      cache: { up: cache, required: false },
    },
    latency: percentiles('skyup_request_duration_ms'),
    uptimeSeconds: Math.round(process.uptime()),
    checkedInMs: Date.now() - started,
  };

  return NextResponse.json(body, {
    status: database ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
