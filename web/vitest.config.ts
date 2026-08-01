import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts', 'test/**/*.test.tsx'],
    // jsdom arrives with the shell in P1-11; node is fine for the empty
    // suite here.
    environment: 'node',
  },
});
