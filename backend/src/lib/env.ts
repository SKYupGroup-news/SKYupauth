import { z } from 'zod';

/**
 * Parsed once at module load so a misconfigured deploy fails immediately and
 * loudly, rather than at the first request that happens to need the variable.
 */
const schema = z.object({
  /// Runtime connections. Point this at PgBouncer (transaction pooling) in
  /// any environment with real traffic.
  DATABASE_URL: z.string().min(1),
  /// A DIRECT connection, bypassing the pooler. Prisma Migrate takes session
  /// advisory locks and runs DDL, neither of which survives a transaction-
  /// pooled connection being handed to another client mid-migration.
  DIRECT_DATABASE_URL: z.string().optional(),
  /// Read-only replica. Admin and analytics reads go here so heavy aggregate
  /// queries never compete with sign-in for connections on the primary.
  /// Unset means every read uses the primary, which is correct but shares load.
  REPLICA_DATABASE_URL: z.string().optional(),

  /// Per-instance pool size. Small on purpose: PgBouncer is the real pool, and
  /// a large pool per instance just moves the connection storm one hop back.
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  APP_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /// Redis carries session lookups and rate-limit counters. Optional: with no
  /// URL the app falls back to Postgres, which is correct but does not scale.
  REDIS_URL: z.string().optional(),
  /// Bearer token guarding /api/metrics. Unset leaves the endpoint open.
  METRICS_TOKEN: z.string().optional(),

  /// Where avatar bytes live. "database" is the zero-setup default; move to
  /// "s3" behind a CDN before real traffic.
  AVATAR_DRIVER: z.enum(['database', 'disk', 's3']).default('database'),
  AVATAR_DISK_PATH: z.string().default('./.avatars'),
  AVATAR_S3_ENDPOINT: z.string().optional(),
  AVATAR_S3_TOKEN: z.string().optional(),
  /// Public CDN origin. When set, avatar URLs point at the CDN and image
  /// requests never reach this service.
  AVATAR_CDN_URL: z.string().optional(),
  /// Seconds a resolved session stays cached. Short on purpose — a revoked
  /// session must stop working quickly, and this is the upper bound on that.
  SESSION_CACHE_TTL_SECONDS: z.coerce.number().int().positive().max(300).default(30),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  JWT_ISSUER: z.string().default('skyup-news'),
  /// Set to e.g. ".skyupnews.com" so session cookies are shared between the
  /// auth service and the reader app when they sit on different subdomains.
  COOKIE_DOMAIN: z.string().optional(),
  JWT_AUDIENCE: z.string().default('skyup-news-web'),

  EMAIL_DRIVER: z.enum(['console', 'resend']).default('console'),
  SMS_DRIVER: z.enum(['console', 'twilio']).default('console'),
  EMAIL_FROM: z.string().default('SkyUp News <no-reply@skyupnews.com>'),
  RESEND_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // Plan catalog lives in the platform's subscription-service.
  SUBSCRIPTION_SERVICE_URL: z.string().url().default('http://localhost:8083'),

  // Razorpay. Checkout is disabled (501) when the key pair is absent.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  /// Comma-separated browser origins allowed to call this API with credentials.
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
