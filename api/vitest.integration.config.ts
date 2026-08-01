import { defineConfig } from 'vitest/config';

// Integration suite. Runs against a real Postgres reachable via
// DATABASE_URL. `test:integration` boots a scratch DB and applies
// migrations before every file — do not run this against a production
// database.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false, // shared Postgres
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['reflect-metadata'],
  },
});
