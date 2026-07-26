import path from 'node:path'
import os from 'node:os'
import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173)
const serverURL = `http://127.0.0.1:${port}`
const baseURL = serverURL
const selfHostedPort = port + 1
const selfHostedServerURL = `http://127.0.0.1:${selfHostedPort}`
const selfHostedURL = `http://stlquest.test:${selfHostedPort}`
const root = process.env.PLAYWRIGHT_DATA_ROOT ?? path.join(os.tmpdir(), `stlquest-playwright-${port}`)
const selfHostedRoot = `${root}-self-hosted`
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
  projects: [
    {
      name: 'chromium',
      testIgnore: ['auth-http.spec.ts', 'preview-seed.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'self-hosted-http',
      testMatch: 'auth-http.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: selfHostedURL,
        launchOptions: { args: ['--host-resolver-rules=MAP stlquest.test 127.0.0.1'] },
      },
    },
  ],
  webServer: [
    {
      command: `rm -rf ${root} && mkdir -p ${root}/data ${root}/prints && DATA_DIR=${root}/data PRINTS_DIR=${root}/prints BETTER_AUTH_URL=${baseURL} PORT=${port} ${serverCommand}`,
      url: `${serverURL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `rm -rf ${selfHostedRoot} && mkdir -p ${selfHostedRoot}/data ${selfHostedRoot}/prints && DATABASE_URL= NODE_ENV=production DATA_DIR=${selfHostedRoot}/data PRINTS_DIR=${selfHostedRoot}/prints PORT=${selfHostedPort} ${serverCommand}`,
      url: `${selfHostedServerURL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
