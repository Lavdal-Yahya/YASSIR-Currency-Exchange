import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// Integration suite. Runs against a real Postgres reachable via
// DATABASE_URL. `test:integration` boots a scratch DB and applies
// migrations before every file — do not run this against a production
// database.
//
// SWC replaces vitest's default esbuild transformer because esbuild does
// not emit decorator metadata (`design:paramtypes`), which Nest's DI
// needs to resolve constructor types at runtime. Without it,
// NestFactory.create(AppModule) throws while wiring providers.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false, // shared Postgres
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['reflect-metadata'],
  },
});
