import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui', timeout: 30000, fullyParallel: false, workers: 1,
  reporter: [['list']], outputDir: 'test-results/support-ui',
  use: { baseURL: 'http://127.0.0.1:3027', browserName: 'chromium', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/fixtures/supportUiServer.mjs', url: 'http://127.0.0.1:3028/admin', timeout: 120000, reuseExistingServer: false },
});
