import { render } from '@/lib/metrics';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Prometheus scrape endpoint.
 *
 * Guarded by a bearer token when METRICS_TOKEN is set: request volumes and
 * error rates tell an attacker a lot about a system, so this should not be
 * open on a public origin.
 */
export async function GET(request: Request) {
  if (env.METRICS_TOKEN) {
    const header = request.headers.get('authorization');
    if (header !== `Bearer ${env.METRICS_TOKEN}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  return new Response(render(), {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
