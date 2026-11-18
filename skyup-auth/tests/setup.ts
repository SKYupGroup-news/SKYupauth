import { config } from 'dotenv';

// Loaded before any module reads process.env, so the app's env schema sees the
// test database rather than the development one.
config({ path: '.env.test', override: true });
