import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    globals: false,
    include: ['test/**/*.test.ts'],
    setupFiles: ['reflect-metadata'],
    testTimeout: 15_000,
  },
});
