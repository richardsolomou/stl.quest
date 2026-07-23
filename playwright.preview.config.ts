import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PREVIEW_BASE_URL
if (!baseURL) throw new Error('PREVIEW_BASE_URL is required')
const username = process.env.PREVIEW_BASIC_AUTH_USERNAME
const password = process.env.PREVIEW_BASIC_AUTH_PASSWORD
if (!username || !password) throw new Error('PREVIEW_BASIC_AUTH_USERNAME and PREVIEW_BASIC_AUTH_PASSWORD are required')

export default defineConfig({
  testDir: './e2e',
  testMatch: 'preview-seed.spec.ts',
  retries: 2,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    httpCredentials: { username, password },
    trace: 'retain-on-failure',
  },
})
