import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const screenshots = path.join(process.cwd(), 'test-results/manual-inspection')
const captureScreenshots = process.env.CAPTURE_E2E_SCREENSHOTS === '1' || process.env.CAPTURE_SCREENSHOTS === '1'

test.beforeAll(async () => {
  if (captureScreenshots) await fs.mkdir(screenshots, { recursive: true })
})

test('manages profile details through the protected account surface', async ({ page }) => {
  await page.goto('/')
  const setup = page.getByRole('button', { name: 'Set up STL Quest' })
  if (await setup.isVisible()) {
    await setup.click()
    await page.getByLabel('Name').fill('Owner')
    await page.getByLabel('Email').fill('owner@example.com')
    await page.getByLabel('Password').fill('correct-horse-battery-staple')
    await page.getByLabel('Password').press('Enter')
    await page.getByRole('button', { name: 'Skip storage for now' }).click()
    await page.getByRole('button', { name: 'Skip printers for now' }).click()
  } else {
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByLabel('Email').fill('owner@example.com')
    await page.getByLabel('Password').fill('correct-horse-battery-staple')
    await page.getByLabel('Password').press('Enter')
  }

  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove password' })).toBeDisabled()
  await page.getByRole('button', { name: 'Edit profile' }).click()
  const profileDialog = page.getByRole('dialog', { name: 'Edit profile' })
  await profileDialog.getByLabel('Name').fill('   ')
  await profileDialog.getByRole('button', { name: 'Save profile' }).click()
  await expect(profileDialog.getByText('Name is required.')).toBeVisible()
  if (captureScreenshots) await page.screenshot({ path: path.join(screenshots, 'account-profile-validation.png'), fullPage: true })

  await profileDialog.getByLabel('Name').fill('Owner Updated')
  await profileDialog.getByRole('button', { name: 'Save profile' }).click()
  await expect(profileDialog).toHaveCount(0)
  await expect(page.getByText('Owner Updated', { exact: true })).toBeVisible()
  expect((await page.request.post('/api/auth/change-email', { data: { newEmail: 'attacker@example.com' } })).status()).toBe(404)
  expect((await page.request.post('/api/auth/unlink-account', { data: { providerId: 'credential' } })).status()).toBe(404)
})
