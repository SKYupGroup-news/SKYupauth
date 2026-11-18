import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';

/**
 * CORS for the audience-side app, which runs on its own origin in development.
 *
 * Credentialed requests forbid a wildcard origin, so the incoming Origin is
 * echoed back only when it appears in ALLOWED_ORIGINS. Anything else gets no
 * CORS headers at all and is blocked by the browser.
 */
function applyCors(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get('origin');
  if (!origin || !env.ALLOWED_ORIGINS.includes(origin)) return response;

  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  response.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Correlation-ID',
  );
  response.headers.set('Access-Control-Max-Age', '86400');
  // Caches must not serve one origin's CORS response to another.
  response.headers.set('Vary', 'Origin');

  return response;
}

export function middleware(request: NextRequest) {
  if (request.method === 'OPTIONS') {
    return applyCors(request, new NextResponse(null, { status: 204 }));
  }

  return applyCors(request, NextResponse.next());
}

export const config = {
  matcher: '/api/:path*',
};
