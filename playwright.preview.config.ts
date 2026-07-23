import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PREVIEW_BASE_URL
if (!baseURL) throw new Error('PREVIEW_BASE_URL is required')
const accessClientId = process.env.CF_ACCESS_CLIENT_ID
const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET
if (!accessClientId || !accessClientSecret) throw new Error('CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required')

export default defineConfig({
  testDir: './e2e',
  testMatch: 'preview-seed.spec.ts',
  retries: 2,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    extraHTTPHeaders: {
      'CF-Access-Client-Id': accessClientId,
      'CF-Access-Client-Secret': accessClientSecret,
    },
    trace: 'retain-on-failure',
  },
})
