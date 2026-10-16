import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { ARTIFACTS_DIR, AUTH_DIR } from './helpers/env';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:1447';

export default defineConfig({
  testDir: './specs',
  outputDir: path.join(ARTIFACTS_DIR, 'test-results'),
  globalSetup: './global-setup.ts',
  // Shared seed DB + Strapi admin login rate limit: run serially.
  workers: 1,
  fullyParallel: false,
  // @slow specs boot extra Strapi apps and TRUNCATE a test database: opt in with E2E_SLOW=1 (see README).
  grepInvert: process.env.E2E_SLOW === '1' ? undefined : /@slow/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: path.join(ARTIFACTS_DIR, 'playwright-report'), open: 'never' }], ['json', { outputFile: path.join(ARTIFACTS_DIR, 'results.json') }]],
  use: {
    baseURL: BASE_URL,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: { width: 1440, height: 900 },
    storageState: path.join(AUTH_DIR, 'admin.json'),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
