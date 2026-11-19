import fs from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/test'

const password = 'correct-horse-battery-staple'
const captureScreenshots = process.env.CAPTURE_E2E_SCREENSHOTS === '1'
const printers = ['Elegoo Saturn 4 Ultra', 'Anycubic Photon Mono M7 Pro']
const resin = 'E2E premium resin'

test('prices one job on each printer with its own costs', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await enterAdminWorkspace(page)

  await page.goto('/settings/printers')
  for (const printer of printers) {
    await page.getByRole('button', { name: 'Add printer' }).click()
    await page.getByLabel('Search printers').fill(printer)
    await page.getByRole('button', { name: `Add ${printer}`, exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Printer name' }).last()).toHaveValue(printer)
  }
  await expect(page.locator('[data-slot="settings-page"]')).toHaveAttribute('data-saving', 'false')

  await page.goto('/settings/consumables')
  await page.getByRole('button', { name: 'Add resin' }).click()
  await page.getByLabel('Name').last().fill(resin)
  await page
    .getByLabel(/^Price \(.\/L\)/)
    .last()
    .fill('400')
  await page.getByRole('button', { name: 'Save consumables' }).click()
  await expect(page.getByRole('button', { name: 'Save consumables' })).toBeDisabled()
  await screenshot(page, 'consumables-settings')

  await page.goto('/calculator')
  await page.getByLabel('Expected material').fill('100')
  await page.getByLabel('Total print hours').fill('3')
  const quote = page.getByRole('group', { name: 'Rough quote' })
  const saturn = quote.getByRole('button', { name: new RegExp(`^${printers[0]} `) })
  const anycubic = quote.getByRole('button', { name: new RegExp(`^${printers[1]} `) })
  // Without their own costs, every printer prices the job with the workspace setup.
  await expect(saturn).toHaveText((await anycubic.textContent())!.replace(printers[1], printers[0]))

  await page.getByLabel('Price on').click()
  await page.getByRole('option', { name: printers[0] }).click()
  await page.getByRole('button', { name: 'Give it its own costs' }).click()
  // The printer uses a resin from the consumables library rather than its own price.
  await page.getByLabel('From your consumables').click()
  await page.getByRole('option', { name: resin }).click()
  await page.getByRole('button', { name: 'Save setup' }).click()
  await expect(page.getByRole('button', { name: 'Edit setup' })).toBeVisible()
  await expect(saturn).not.toHaveText((await anycubic.textContent())!.replace(printers[1], printers[0]))
  await expect(saturn).toHaveAttribute('aria-pressed', 'true')
  await screenshot(page, 'printer-costs-calculator')

  // The printer's own costs are saved, so a fresh visit prices it the same way.
  await page.reload()
  await page.getByLabel('Price on').click()
  await page.getByRole('option', { name: printers[0] }).click()
  await expect(page.getByText(`${printers[0]} has its own material`)).toBeVisible()
  await expect(page.getByText(resin, { exact: true })).toBeVisible()

  // Removing the printers removes their costs, leaving the fleet as the other journeys expect.
  await page.goto('/settings/printers')
  for (const printer of printers) {
    await page.getByRole('button', { name: `Remove ${printer}` }).click()
    await page
      .getByRole('alertdialog', { name: `Remove “${printer}”?` })
      .getByRole('button', { name: 'Remove printer' })
      .click()
    await expect(page.getByRole('button', { name: `Remove ${printer}` })).toHaveCount(0)
  }
  await expect(page.locator('[data-slot="settings-page"]')).toHaveAttribute('data-saving', 'false')
  await page.goto('/settings/consumables')
  await page.getByRole('button', { name: `Remove ${resin}` }).click()
  await page.getByRole('button', { name: 'Save consumables' }).click()
  await expect(page.getByText('No resins yet.')).toBeVisible()
})

async function enterAdminWorkspace(page: Page) {
  await page.goto('/')
  const setupButton = page.getByRole('button', { name: 'Set up STL Quest' })
  const signInButton = page.getByRole('button', { name: 'Sign in', exact: true })
  await expect(setupButton.or(signInButton)).toBeVisible()
  if (await signInButton.isVisible()) {
    await page.getByLabel('Email').fill('owner@example.com')
    await page.getByLabel('Password').fill(password)
    await signInButton.click()
    await expect(page.getByRole('button', { name: 'Add a print' })).toBeVisible()
    return
  }
  await setupButton.click()
  await page.getByLabel('Name').fill('Owner')
  await page.getByLabel('Email').fill('owner@example.com')
  await page.getByLabel('Password').fill(password)
  await page.getByLabel('Password').press('Enter')
  await page.getByRole('button', { name: 'Use this folder' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('button', { name: 'Add a print' })).toBeVisible()
}

async function screenshot(page: Page, name: string) {
  if (!captureScreenshots) return
  const screenshotDirectory = path.join(process.cwd(), 'test-results/manual-inspection')
  await fs.mkdir(screenshotDirectory, { recursive: true })
  await page.screenshot({ path: path.join(screenshotDirectory, `${name}.png`), fullPage: true })
}
