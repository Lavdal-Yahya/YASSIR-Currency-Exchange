import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // Integration tests run against a real Postgres in P3+. Concurrency
    // matters for the ledger tests, but only within one file — the DB
    // fixture is process-shared. Keep parallelism per-file only.
    fileParallelism: false,
  },
});
