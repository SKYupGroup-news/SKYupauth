import pg from 'pg';
import { logger } from './logger';

const { Pool } = pg;

// Connection string for the EMS registry database where employee rosters are maintained
const EMS_DB_URL =
  process.env.EMS_DATABASE_URL ||
  process.env.DIRECT_DATABASE_URL?.replace('/skyup_auth', '/ems_co_skyup_news') ||
  'postgresql://postgres:postgrespassword@127.0.0.1:5432/ems_co_skyup_news';

const globalForEms = globalThis as unknown as { emsPool?: pg.Pool };

export const emsPool =
  globalForEms.emsPool ??
  new Pool({
    connectionString: EMS_DB_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForEms.emsPool = emsPool;
}

emsPool.on('error', (err) => {
  logger.warn('EMS Postgres Pool background error', { error: err.message });
});
