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
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text', 'html'],
    },
  },
});
