import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
export const SUBPATH_PORT = 4174;

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.js',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: `node scripts/serve.mjs --port ${PORT}`,
      url: `http://localhost:${PORT}/demo/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      // The repo mounted under a GitHub Pages-style project subpath (M5 test 4).
      command: `node scripts/serve.mjs --port ${SUBPATH_PORT} --prefix /my-repo/`,
      url: `http://localhost:${SUBPATH_PORT}/my-repo/demo/`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
