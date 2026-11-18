import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { prisma } from './lib/db';
import { isProduction } from './lib/env';
import { errorHandler } from './lib/http';
import { correlationMiddleware, logger } from './lib/logger';
import { authRouter } from './routes/auth.routes';
import { adminUsersRouter } from './routes/admin-users.routes';
import { adminAudienceRouter } from './routes/admin-audience.routes';
import { adminCommentsRouter } from './routes/admin-comments.routes';
import { adminEmployeesRouter } from './routes/admin-employees.routes';
import { adminIntegrationRouter } from './routes/admin-integration.routes';
import { commentsRouter } from './routes/comments.routes';
import { profileRouter } from './routes/profile.routes';
import { subscriptionRouter } from './routes/subscription.routes';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

// Trust reverse proxy (e.g. AWS ALB, Cloudflare, NGINX) to get correct client IPs
app.set('trust proxy', 1);

// HTTP Security Headers (OWASP recommended baseline)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);

// Distributed Tracing & Request Logging
app.use(correlationMiddleware);

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3100',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3100',
  'http://127.0.0.1:5173',
];

if (process.env.ALLOWED_ORIGINS) {
  const envOrigins = process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  allowedOrigins.push(...envOrigins);
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server or curl requests with no origin
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);

      if (isProduction) {
        return callback(new Error('Cross-Origin Request Blocked by Policy'));
      }
      return callback(null, true);
    },
    credentials: true,
  })
);

app.use(cookieParser());
// Body payload size caps to mitigate memory exhaustion & DoS attacks
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Liveness Probe (process is responsive)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'skyup-backend',
    port: PORT,
    timestamp: new Date().toISOString(),
  });
});

// Deep Readiness Probe (verifies database connectivity & latency)
app.get('/api/health/ready', async (req, res) => {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;

    res.json({
      status: 'ready',
      database: 'connected',
      latencyMs: latency,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('Readiness probe failed database check', { error: err.message });
    res.status(503).json({
      status: 'unavailable',
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Mount Routes
app.use('/api/auth', authRouter);
app.use('/api/admin', adminUsersRouter);
app.use('/api/admin', adminAudienceRouter);
app.use('/api/admin', adminCommentsRouter);
app.use('/api/admin', adminEmployeesRouter);
app.use('/api/admin/integration', adminIntegrationRouter);
app.use('/api', commentsRouter);
app.use('/api', profileRouter);
app.use('/api', subscriptionRouter);

// Global Error Handler
app.use(errorHandler);

// Start Server with Graceful Shutdown
const server = app.listen(PORT, () => {
  logger.info(`🚀 SkyUp Enterprise Backend running on http://localhost:${PORT}`);
  logger.info(`   Liveness check:  http://localhost:${PORT}/api/health`);
  logger.info(`   Readiness check: http://localhost:${PORT}/api/health/ready`);
});

// Graceful Process Termination (SIGTERM / SIGINT for Docker/Kubernetes)
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  server.close(async () => {
    logger.info('HTTP server closed.');
    try {
      await prisma.$disconnect();
      logger.info('Database pool closed cleanly.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during database disconnect', { error: String(err) });
      process.exit(1);
    }
  });

  // Force termination if cleanup takes longer than 10s
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
