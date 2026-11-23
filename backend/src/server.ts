import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { prisma } from './lib/db';
import { env, isProduction } from './lib/env';
import { emsPool } from './lib/ems-db';
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
app.disable('x-powered-by');
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
  'https://skyupnews.com',
  'https://www.skyupnews.com',
  'https://mediahouse.skyupnews.com',
  'https://newsanalyst.skyupnews.com',
  'https://auth.skyupnews.com',
  ...(!isProduction
    ? [
        'http://localhost:3000',
        'http://localhost:3100',
        'http://localhost:5173',
        'http://localhost:5174',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3100',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
      ]
    : []),
];

if (process.env.ALLOWED_ORIGINS) {
  const envOrigins = process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim().replace(/\/+$/, ''));
  allowedOrigins.push(...envOrigins);
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server or curl requests with no origin
      if (!origin) return callback(null, true);
      const cleanOrigin = origin.replace(/\/+$/, '');
      if (
        allowedOrigins.includes(cleanOrigin) ||
        /^https:\/\/([a-z0-9-]+\.)?skyupnews\.com$/i.test(cleanOrigin)
      ) {
        return callback(null, true);
      }

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
    environment: env.NODE_ENV,
    port: PORT,
    timestamp: new Date().toISOString(),
  });
});

// Cross-Platform Ecosystem Integration Endpoint (used by skyupnews.com, mediahouse.skyupnews.com, newsanalyst.skyupnews.com)
app.get('/api/integration', (req, res) => {
  res.json({
    status: 'ok',
    service: 'skyup-auth',
    url: 'https://auth.skyupnews.com',
    ecosystem: {
      audienceNews: 'https://skyupnews.com',
      mediaHouse: 'https://mediahouse.skyupnews.com/',
      newsAnalyst: 'https://newsanalyst.skyupnews.com/login',
      authService: 'https://auth.skyupnews.com',
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/integration/employees', async (req, res) => {
  try {
    const department = typeof req.query.department === 'string' ? req.query.department.trim() : '';
    const result = await emsPool.query(
      `SELECT e.*, o.name AS company_name, o.code AS company_code
       FROM employees e
       LEFT JOIN organisations o ON e.org_id = o.id
       WHERE COALESCE(o.name, 'SKYup Auth') ILIKE '%Auth%'
       ORDER BY e.id ASC`
    );
    let employees = result.rows;
    if (department) {
      employees = employees.filter((r: any) =>
        (r.department_name || '').toLowerCase().includes(department.toLowerCase())
      );
    }
    res.json({
      ok: true,
      workspace: 'SKYup Auth',
      employees,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to query EMS employees' });
  }
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
      error: isProduction ? 'Database connectivity check failed' : err.message,
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
