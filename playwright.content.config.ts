import { defineConfig } from '@playwright/test';

// DOM component tests: real Chromium + built content script, mocked runtime messages.
// These do not exercise extension loading, Chrome storage, or the service worker.
export default defineConfig({
  outputDir: 'test-results/content',
  testDir: './tests/content',
  workers: 1,
  fullyParallel: false,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
