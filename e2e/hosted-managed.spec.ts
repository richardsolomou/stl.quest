import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { boxStl } from './fixtures/stl'

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
  await expect(
    page.getByText(
      'Hosted by STL Quest. Your Free plan includes 1.0 GB total for models, previews, and thumbnails, shared across all your workspaces. Nothing else to configure.',
    ),
  ).toBeVisible()
  await screenshot(page, 'hosted-storage-onboarding')
  await page.getByRole('button', { name: 'Use included storage' }).click()
  await expect(page.getByRole('heading', { name: 'Add the printers you own' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  const storageIndicator = page.getByRole('button', { name: '1.0 GB storage available' })
  await expect(storageIndicator).toBeVisible()
  await storageIndicator.click()
  const storageUsage = page.getByText('of 1.0 GB used')
  await expect(storageUsage).toBeVisible()
  await expect(page.getByRole('link', { name: 'Upgrade to Supporter' })).toBeVisible()
  await screenshot(page, 'hosted-storage-indicator')
  await page.keyboard.press('Escape')
  await expect(storageUsage).toBeHidden()

  await page.getByRole('button', { name: 'Open account menu' }).click()
  await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Plan Free' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Hosted Owner' })).toHaveCount(0)
  await screenshot(page, 'hosted-account-menu')
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 320, height: 720 })
  await page.getByRole('button', { name: 'Open account menu' }).click()
  await expect(page.getByRole('link', { name: 'Plan Free' })).toBeVisible()
  await screenshot(page, 'hosted-account-menu-mobile')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1280, height: 720 })

  await page.goto('/plan')
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { name: 'Plan' })).toBeVisible()
  await expect(main.getByText('The Free plan includes 1.0 GB of managed storage.')).toBeVisible()
  await expect(main.getByText('of 1.0 GB used')).toBeVisible()
  await expect(main.getByText('Available', { exact: true })).toBeVisible()
  await expect(main.getByText('Change plan', { exact: true })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Choose Supporter' })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Choose Pro' })).toBeVisible()
  await screenshot(page, 'hosted-plan-page', true)

  // The plan moved off the account page, which now only covers profile and sign-in.
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
  await expect(page.getByText('Change plan', { exact: true })).toHaveCount(0)
  await screenshot(page, 'hosted-account-page', true)

  await page.goto('/settings/storage')
  await expect(page.getByRole('heading', { name: 'Change where your models live' })).toBeVisible()
  await expect(page.getByText('0 B used or reserved')).toBeVisible()
  await expect(page.getByText('1.0 GB available')).toBeVisible()
  await screenshot(page, 'hosted-shared-storage', true)
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
  await expect(page).toHaveURL('/')
  await expect(page.getByText('Second workshop', { exact: true })).toBeVisible()
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
  await expect(page.getByLabel('1 person viewing this board')).toBeVisible()
  await page.getByRole('button', { name: 'Open account menu' }).click()
  await expect(page.getByRole('button', { name: '3 workspace limit reached' })).toBeDisabled()
  await screenshot(page, 'hosted-workspace-limit', true)
  await page.keyboard.press('Escape')

  // Uploads land on the shared allowance, so put different amounts in two workspaces and check the
  // plan page attributes them separately.
  await page.keyboard.press('Escape')
  await upload(page, 'third-workshop-model')
  await upload(page, 'third-workshop-spare')
  await page.goto('/account')
  await switchWorkspace(page, "Hosted Owner's workspace")
  await expect(page).toHaveURL('/')
  await upload(page, 'owner-workspace-model')

  // One allowance is shared, so the plan page has to account for every entitled workspace.
  await page.goto('/plan')
  for (const workspace of ["Hosted Owner's workspace", 'Second workshop', 'Third workshop']) {
    await expect(page.getByText(workspace, { exact: true })).toBeVisible()
  }
  await expect(page.getByText('Available', { exact: true })).toBeVisible()
  await expect(page.getByText('of 1.0 GB used')).toBeVisible()
  await screenshot(page, 'hosted-plan-shared-allowance', true)

  // The allowance belongs to the account, so the rail reports it away from the board too.
  for (const route of ['/plan', '/account', '/settings/storage']) {
    await page.goto(route)
    await expect(page.getByRole('button', { name: /storage available/ })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: 'Storage settings' })).toHaveCount(0)
  await page.goto('/plan')
  await page.getByRole('button', { name: /storage available/ }).click()
  await expect(page.getByText('Included storage', { exact: true })).toBeVisible()
  await screenshot(page, 'hosted-allowance-off-board')
})

// Popovers fade in, so settle before capturing and freeze animations to avoid half-drawn panels.
async function screenshot(page: Page, name: string, fullPage = false) {
  if (!captureScreenshots) return
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage, animations: 'disabled' })
}

async function upload(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add a print' }).click()
  await expect(page.getByRole('dialog', { name: 'Add prints' })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({ name: `${name}.stl`, mimeType: 'model/stl', buffer: boxStl(name, 10, 10, 10) })
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Add 1 print' }).click()
  await expect(page.locator(`button.card[data-request-name="${name}"]`)).toBeVisible({ timeout: 30_000 })
}

async function switchWorkspace(page: Page, name: string) {
  await page.getByRole('button', { name: 'Open account menu' }).click()
  await page.getByRole('button', { name }).click()
  await expect(page.getByRole('button', { name: 'Add a print' })).toBeVisible({ timeout: 30_000 })
}
