import 'dotenv/config';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 keeps connection URLs out of schema.prisma. The CLI (migrate,
// introspect, studio) reads it here; the runtime client gets it via the
// pg driver adapter in src/lib/db.ts.
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Schema changes always bypass the pooler — see DIRECT_DATABASE_URL.
    url: process.env.DIRECT_DATABASE_URL || env('DATABASE_URL'),
  },
});
