import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DEBUG__: 'true',
    __INLINE_SHEET__: 'null',
  },
  test: {
    include: ['test/unit/**/*.test.js'],
    environment: 'node',
    passWithNoTests: true,
    // The statistical engine tests simulate millions of steps; coverage instrumentation slows them further.
    testTimeout: 120000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text', 'html'],
    },
  },
});
