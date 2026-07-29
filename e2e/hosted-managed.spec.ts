import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const captureScreenshots = process.env.CAPTURE_E2E_SCREENSHOTS === '1'
const screenshots = path.join(process.cwd(), 'test-results/manual-inspection')

test.beforeAll(async () => {
  if (captureScreenshots) await fs.mkdir(screenshots, { recursive: true })
})

test('shares included storage across three hosted workspaces and enforces the ownership limit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Set up STL Quest' }).click()
  await page.getByLabel('Name').fill('Hosted Owner')
  await page.getByLabel('Email').fill('hosted-owner@example.com')
  await page.getByLabel('Password').fill('correct-horse-battery-staple')
  await page.getByLabel('Password').press('Enter')

  await expect(page.getByText('Included storage', { exact: true })).toBeVisible()
  await expect(page.getByText('Your account includes 1 GB')).toBeVisible()
  await page.getByRole('button', { name: 'Use included storage' }).click()
  await expect(page.getByRole('heading', { name: 'Add the printers you own' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('link', { name: '1.0 GB storage available' })).toBeVisible()

  await page.goto('/settings/storage')
  await expect(page.getByRole('heading', { name: 'Change where your models live' })).toBeVisible()
  await expect(page.getByText('0 B used or reserved')).toBeVisible()
  await expect(page.getByText('1.0 GB available')).toBeVisible()
  if (captureScreenshots) await page.screenshot({ path: path.join(screenshots, 'hosted-shared-storage.png'), fullPage: true })
  await page.getByRole('button', { name: /S3-compatible bucket/ }).click()
  await expect(page.getByRole('heading', { name: 'Switch to an S3-compatible bucket' })).toBeVisible()
  await page.getByLabel('Provider').click()
  await page.getByRole('option', { name: 'Custom S3-compatible' }).click()
  await page.getByLabel('S3 endpoint').fill('https://abandoned.example.com')
  await page.getByRole('button', { name: 'All storage options' }).click()
  await page.getByRole('button', { name: /Remote folder over WebDAV/ }).click()
  await expect(page.getByRole('heading', { name: 'Switch to a remote folder' })).toBeVisible()
  await expect(page.getByLabel('WebDAV endpoint')).toHaveValue('')
  await page.getByRole('button', { name: 'All storage options' }).click()
  await expect(page.getByRole('button', { name: 'Edit current storage' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Open account menu' }).click()
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await page.getByLabel('Workspace name').fill('Second workshop')
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(page.getByText('Second workshop', { exact: true })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Use included storage' })).toBeVisible()
  await page.getByRole('button', { name: 'Use included storage' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.goto('/settings/storage')
  await expect(page.getByText('Hosted by STL Quest. Your account’s storage is shared across every workspace using it.')).toBeVisible()
  await expect(page.getByText('Models go to Local storage.')).toHaveCount(0)

  await page.getByRole('button', { name: 'Open account menu' }).click()
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await page.getByLabel('Workspace name').fill('Third workshop')
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(page.getByText('Third workshop', { exact: true })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Use included storage' })).toBeVisible()
  await page.getByRole('button', { name: 'Use included storage' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: 'Open account menu' }).click()
  await expect(page.getByRole('button', { name: '3 workspace limit reached' })).toBeDisabled()
  if (captureScreenshots) await page.screenshot({ path: path.join(screenshots, 'hosted-workspace-limit.png'), fullPage: true })
})
