import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma';
import { env, isProduction } from './env';

// Next.js hot-reloads modules in dev; without the global cache every reload
// would open a fresh connection pool and exhaust Postgres' connection limit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    // Bounded per instance. With PgBouncer in front, every app instance holding
    // a large pool would defeat the point of pooling at all.
    max: env.DATABASE_POOL_MAX,
    // Recycle idle connections so a pooler restart does not leave the app
    // holding sockets that are already dead.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return new PrismaClient({
    adapter,
    log: isProduction ? ['error'] : ['warn', 'error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (!isProduction) globalForPrisma.prisma = prisma;

/**
 * Read-only client pointed at a streaming replica.
 *
 * Only for queries that tolerate a little staleness: the audience list,
 * moderation, dashboard counts. Sign-in and anything read-then-written must
 * stay on the primary — replication lag is small but not zero, and reading your
 * own write from a replica is how "I saved it and it vanished" bugs happen.
 *
 * Falls back to the primary when no replica is configured, so call sites can
 * use it unconditionally.
 */
const globalForReplica = globalThis as unknown as { replica?: PrismaClient };

function createReplica(): PrismaClient {
  if (!env.REPLICA_DATABASE_URL) return prisma;

  const adapter = new PrismaPg({
    connectionString: env.REPLICA_DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log: isProduction ? ['error'] : ['warn', 'error'],
  });
}

export const replica: PrismaClient = globalForReplica.replica ?? createReplica();

if (!isProduction && env.REPLICA_DATABASE_URL) globalForReplica.replica = replica;

/** True when reads are actually being served by a separate instance. */
export const hasReplica = Boolean(env.REPLICA_DATABASE_URL);

export * from '@/generated/prisma';

/**
 * Row-count estimate from the planner's statistics.
 *
 * A real COUNT(*) walks the whole table — ~47ms on 800k comments, and it grows
 * linearly. Dashboard totals do not need to be exact, so they read the estimate
 * and fall back to counting only on small tables where it is both cheap and
 * where the estimate is least reliable.
 */
export async function estimatedCount(table: string): Promise<number> {
  // Reads the planner's statistics, so it belongs on the replica with the rest
  // of the dashboard queries.
  const rows = await replica.$queryRaw<Array<{ estimate: bigint }>>`
    SELECT reltuples::bigint AS estimate
    FROM pg_class WHERE oid = ${`public.${table}`}::regclass
  `;
  return Number(rows[0]?.estimate ?? 0);
}
