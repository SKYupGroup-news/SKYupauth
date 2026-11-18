import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { isProduction } from './env';

export interface LogContext {
  correlationId?: string;
  [key: string]: unknown;
}

function formatLog(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, meta?: LogContext): string {
  const timestamp = new Date().toISOString();
  if (isProduction) {
    return JSON.stringify({
      timestamp,
      level,
      message,
      ...meta,
    });
  }
  const cid = meta?.correlationId ? ` [${meta.correlationId.slice(0, 8)}]` : '';
  const details = meta && Object.keys(meta).length > 1 ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level}]${cid} ${message}${details}`;
}

export const logger = {
  info(message: string, meta?: LogContext) {
    console.log(formatLog('INFO', message, meta));
  },
  warn(message: string, meta?: LogContext) {
    console.warn(formatLog('WARN', message, meta));
  },
  error(message: string, meta?: LogContext) {
    console.error(formatLog('ERROR', message, meta));
  },
  debug(message: string, meta?: LogContext) {
    if (!isProduction) console.debug(formatLog('DEBUG', message, meta));
  },
};

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers['x-correlation-id'] || req.headers['x-request-id'];
  const correlationId = typeof incomingId === 'string' && incomingId.trim() ? incomingId.trim() : randomUUID();

  // Attach to request & response headers
  (req as any).correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    // Do not flood logs with health check probes
    if (req.originalUrl.startsWith('/api/health') && statusCode < 400) return;

    logger[logLevel](`${req.method} ${req.originalUrl} ${statusCode} - ${duration}ms`, {
      correlationId,
      method: req.method,
      url: req.originalUrl,
      status: statusCode,
      durationMs: duration,
      ip: req.ip || req.socket.remoteAddress,
    });
  });

  next();
}
