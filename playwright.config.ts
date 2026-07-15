import path from 'node:path'
import os from 'node:os'
import { defineConfig, devices } from '@playwright/test'

const root = path.join(os.tmpdir(), 'printhub-playwright')
const serverCommand = process.env.CI ? 'node .output/server/index.mjs' : './node_modules/.bin/vite dev --host 127.0.0.1 --port 4173'

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `rm -rf ${root} && mkdir -p ${root}/data ${root}/prints && DATA_DIR=${root}/data PRINTS_DIR=${root}/prints BETTER_AUTH_URL=http://127.0.0.1:4173 PORT=4173 ${serverCommand}`,
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
