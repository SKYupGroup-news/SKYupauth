import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    // The suite shares one database, so parallel files would fight over rows.
    fileParallelism: false,
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/generated/**'],
    },
  },
  resolve: {
    // fileURLToPath, not URL.pathname: this project's path contains spaces,
    // which pathname percent-encodes into a directory that does not exist.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
