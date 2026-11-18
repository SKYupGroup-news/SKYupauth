import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';

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

export const STATUS_CODES: Record<ApiErrorCode, number> = {
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

export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

/**
 * Async handler wrapper to catch and forward errors to Express error middleware.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global Express error handling middleware.
 */
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof ApiError) {
    if (err.headers) {
      for (const [k, v] of Object.entries(err.headers)) {
        res.setHeader(k, v);
      }
    }
    const status = STATUS_CODES[err.code] || 400;
    res.status(status).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'invalid_request',
        message: 'Invalid request data',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  console.error('[Unhandled Error]', err);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'An unexpected internal error occurred.',
    },
  });
}
