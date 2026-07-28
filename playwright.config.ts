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
const hostedPort = port + 2
const hostedServerURL = `http://127.0.0.1:${hostedPort}`
const hostedRoot = `${root}-hosted`
const fakeS3Port = port + 3
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
      testIgnore: ['auth-http.spec.ts', 'preview-seed.spec.ts', 'hosted-managed.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'hosted-managed',
      testMatch: 'hosted-managed.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: hostedServerURL },
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
    {
      command: `FAKE_S3_PORT=${fakeS3Port} ./node_modules/.bin/tsx e2e/fake-s3.ts`,
      url: `http://127.0.0.1:${fakeS3Port}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `rm -rf ${hostedRoot} && mkdir -p ${hostedRoot}/data ${hostedRoot}/prints && NODE_ENV=production DATA_DIR=${hostedRoot}/data PRINTS_DIR=${hostedRoot}/prints BETTER_AUTH_URL=${hostedServerURL} PORT=${hostedPort} STLQUEST_HOSTED=true STLQUEST_HOSTED_STORAGE_BUCKET=test-bucket STLQUEST_HOSTED_STORAGE_ENDPOINT=http://127.0.0.1:${fakeS3Port} STLQUEST_HOSTED_STORAGE_REGION=us-east-1 STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID=test STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY=test STLQUEST_HOSTED_STORAGE_FORCE_PATH_STYLE=true ${serverCommand}`,
      url: `${hostedServerURL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
