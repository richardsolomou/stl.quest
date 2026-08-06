import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results/distributed-realtime',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4273', trace: process.env.CI ? 'retain-on-failure' : 'off' },
  testMatch: 'distributed-realtime.spec.ts',
  webServer: {
    command: 'sh scripts/distributedRealtimeE2e.sh',
    url: 'http://127.0.0.1:4273/api/health',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
