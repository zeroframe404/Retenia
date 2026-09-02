import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Electron launches one app instance per worker; serial keeps the output readable and
  // avoids several windows fighting over the same virtual display.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    // Traces only cost anything when a test actually fails or gets retried — CI's
    // "Upload Playwright report and traces" step exists to pull those out.
    trace: 'retain-on-failure',
  },
})
