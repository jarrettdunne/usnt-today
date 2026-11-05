import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/{src,test}/**/*.test.ts', 'jobs/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    // PGlite takes a moment to boot a fresh database per test.
    testTimeout: 20_000,
  },
});
