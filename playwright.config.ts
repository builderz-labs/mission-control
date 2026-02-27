import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3005',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'pnpm start',
    url: 'http://127.0.0.1:3005',
    reuseExistingServer: true,
    timeout: 30_000,
  }
})
