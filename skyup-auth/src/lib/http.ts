import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { increment, observe } from './metrics';

export type ApiErrorCode =
  | 'invalid_request'
  | 'invalid_credentials'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'provider_not_configured'
  | 'internal_error';

const STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  invalid_credentials: 401,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  provider_not_configured: 501,
  internal_error: 500,
};

/** Thrown anywhere in a route handler; `handleRoute` turns it into a JSON response. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/**
 * Wraps a route handler so every thrown error becomes a consistently shaped
 * JSON body. Unexpected errors are logged server-side but never leaked to the
 * client, which would otherwise expose stack traces and query fragments.
 */
/**
 * Route label for metrics: ids are collapsed so a million readers do not become
 * a million distinct time series, which is how monitoring bills explode.
 */
function routeLabel(request: Request): string {
  try {
    return new URL(request.url).pathname
      .replace(/\/c[a-z0-9]{20,}/gi, '/:id')
      .replace(/\/\d+/g, '/:id')
      .replace(/\/[0-9a-f]{16,}/gi, '/:id');
  } catch {
    return 'unknown';
  }
}

export function handleRoute<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    const started = performance.now();
    const request = args[0] instanceof Request ? args[0] : null;
    const route = request ? routeLabel(request) : 'unknown';
    const method = request?.method ?? 'GET';

    const record = (status: number) => {
      const ms = performance.now() - started;
      observe('skyup_request_duration_ms', ms, { route, method });
      increment('skyup_requests_total', { route, method, status: String(status) });
      // Anything past a second is worth finding in the logs later.
      if (ms > 1000) {
        console.warn(`[slow] ${method} ${route} ${Math.round(ms)}ms status=${status}`);
      }
    };

    try {
      const response = await handler(...args);
      record(response.status);
      return response;
    } catch (error) {
      record(
        error instanceof ApiError
          ? STATUS[error.code]
          : error instanceof ZodError
            ? 400
            : 500,
      );
      if (error instanceof ApiError) {
        return NextResponse.json(
          { error: { code: error.code, message: error.message, details: error.details } },
          { status: STATUS[error.code], headers: error.headers },
        );
      }

      if (error instanceof ZodError) {
        return NextResponse.json(
          {
            error: {
              code: 'invalid_request' satisfies ApiErrorCode,
              message: 'Request validation failed.',
              details: error.issues.map((i) => ({
                field: i.path.join('.'),
                message: i.message,
              })),
            },
          },
          { status: 400 },
        );
      }

      console.error('[auth] unhandled route error:', error);
      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Something went wrong.' } },
        { status: 500 },
      );
    }
  };
}

/** Best-effort client IP, used only for rate-limit keys and session metadata. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function parseJson<T>(
  request: Request,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError('invalid_request', 'Request body must be valid JSON.');
  }
  return schema.parse(body);
}
