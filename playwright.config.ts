import path from 'node:path'
import os from 'node:os'
import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173)
const baseURL = `http://127.0.0.1:${port}`
const root = process.env.PLAYWRIGHT_DATA_ROOT ?? path.join(os.tmpdir(), `printhub-playwright-${port}`)
const serverCommand = process.env.PLAYWRIGHT_DEV_SERVER
  ? `./node_modules/.bin/vite dev --host 127.0.0.1 --port ${port}`
  : 'node .output/server/index.mjs'
const trace = process.env.PLAYWRIGHT_TRACE ? 'on' : process.env.CI ? 'retain-on-failure' : 'off'

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace, screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `rm -rf ${root} && mkdir -p ${root}/data ${root}/prints && DATA_DIR=${root}/data PRINTS_DIR=${root}/prints BETTER_AUTH_URL=${baseURL} PORT=${port} ${serverCommand}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
