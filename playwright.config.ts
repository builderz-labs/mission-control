import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  testIgnore: /openclaw-harness\.spec\.ts|gateway-config\.spec\.ts|device-identity\.spec\.ts/,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3005',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'node scripts/e2e-openclaw/start-e2e-server.mjs --mode=local',
    url: 'http://127.0.0.1:3005',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      // WHY: better-sqlite3 is compiled against Node 25 (NMV 141). If the test runner
      // is invoked without the Homebrew Node 25 in PATH, the fresh webServer process
      // inherits the system PATH and loads an incompatible native binding, crashing auth.
      // Prepend the known Node 25 bin so the webServer always uses the right runtime.
      PATH: `/opt/homebrew/Cellar/node/25.8.1_1/bin:/opt/homebrew/bin:${process.env.PATH || ''}`,
      MISSION_CONTROL_TEST_MODE: process.env.MISSION_CONTROL_TEST_MODE || '1',
      MC_DISABLE_RATE_LIMIT: process.env.MC_DISABLE_RATE_LIMIT || '1',
      MC_WORKLOAD_QUEUE_DEPTH_THROTTLE: process.env.MC_WORKLOAD_QUEUE_DEPTH_THROTTLE || '1000',
      MC_WORKLOAD_QUEUE_DEPTH_SHED: process.env.MC_WORKLOAD_QUEUE_DEPTH_SHED || '2000',
      MC_WORKLOAD_ERROR_RATE_THROTTLE: process.env.MC_WORKLOAD_ERROR_RATE_THROTTLE || '1',
      MC_WORKLOAD_ERROR_RATE_SHED: process.env.MC_WORKLOAD_ERROR_RATE_SHED || '1',
      API_KEY: process.env.API_KEY || 'test-api-key-e2e-12345',
      AUTH_USER: process.env.AUTH_USER || 'testadmin',
      AUTH_PASS: process.env.AUTH_PASS || 'testpass1234!',
    },
  }
})
