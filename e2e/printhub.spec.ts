import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { boxStl } from './fixtures/stl'

const email = 'owner@example.com'
const password = 'correct-horse-battery-staple'
const screenshots = path.join(process.cwd(), 'test-results/manual-inspection')
const captureScreenshots = process.env.CAPTURE_E2E_SCREENSHOTS === '1' || process.env.CAPTURE_SCREENSHOTS === '1'

test.beforeAll(async () => {
  if (captureScreenshots) await fs.mkdir(screenshots, { recursive: true })
})

test('manages a fair print queue and assigns work to printers', async ({ page }) => {
  test.setTimeout(180_000)
  const printerName = 'Resin Station With A Long Descriptive Name'
  await optimizePageForE2E(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Set up PrintHub' }).click()
  await page.getByLabel('Name').fill('Owner')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByLabel('Password').press('Enter')

  await expect(page.getByRole('heading', { name: 'Choose storage' })).toBeVisible()
  await page.getByRole('button', { name: 'Finish setup' }).click()
  await expect(page.getByRole('heading', { name: 'Add your printers' })).toBeVisible()
  await page.getByRole('button', { name: 'Add printer' }).click()
  await screenshot(page, 'printer-preset-picker')
  await page.getByLabel('Search printers').fill('Uniformation GK3 Ultra')
  const uniformationResult = page.getByRole('button', { name: 'Add Uniformation GK3 Ultra', exact: true })
  await expect(uniformationResult).toBeVisible()
  await expect.poll(() => uniformationResult.locator('img').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)
  await page.getByLabel('Search printers').fill('HeyGears Reflex 2')
  const heyGearsResult = page.getByRole('button', { name: 'Add HeyGears Reflex 2', exact: true })
  await expect(heyGearsResult).toBeVisible()
  await expect.poll(() => heyGearsResult.locator('img').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)
  await screenshot(page, 'printer-heygears-search-desktop')
  await page.getByLabel('Search printers').fill('resin')
  await expect.poll(() => page.getByRole('button', { name: /^Add / }).count()).toBeLessThan(50)
  await page.getByLabel('Search printers').fill('Elegoo Mars 2')
  await page.getByRole('button', { name: 'Add Elegoo Mars 2', exact: true }).click()
  const presetPrinter = page.getByRole('region', { name: 'Printer 1' })
  await expect(presetPrinter.getByLabel('Printer name')).toHaveValue('Elegoo Mars 2')
  await expect(presetPrinter.getByText('Predefined printer')).toBeVisible()
  await expect.poll(() => presetPrinter.locator('img').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)
  await screenshot(page, 'selected-printer-image')
  await expect(page.getByLabel(/Usable width|Usable depth|Usable height/)).toHaveCount(0)
  await fillPrinter(presetPrinter, { name: printerName, printType: 'Resin' })
  await page.getByRole('button', { name: 'Save and continue' }).click()

  await expect(page.getByRole('link', { name: 'Planner' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sort requests: Rotate by requester' })).toContainText('Rotate by requester')

  await upload(page, { name: 'first-model', printType: 'Resin', buffer: boxStl('first-model', 10, 10, 10) })
  await upload(page, { name: 'large-order', printType: 'Resin', buffer: boxStl('large-order', 20, 10, 10), quantity: 3 })

  await page.getByRole('button', { name: 'Sort requests: Rotate by requester' }).click()
  await screenshot(page, 'grouped-sort-options')
  await page.getByRole('menuitemradio', { name: 'Largest orders first', exact: true }).click()
  const queuedCards = page.locator('[data-status="todo"] button.card')
  await expect(queuedCards.first()).toContainText('large-order')
  await moveCard(page, 'large-order', 'todo', 'up_next')
  await expect(page.locator('[data-status="up_next"] button.card').filter({ hasText: 'large-order' })).toBeVisible()
  await screenshot(page, 'up-next-stage')
  await moveCard(page, 'large-order', 'up_next', 'in_progress')
  await expect(page.locator('[data-status="in_progress"] button.card').filter({ hasText: 'large-order' })).toBeVisible()

  await requestCard(page, 'first-model').click()
  await expect(page.getByRole('combobox', { name: 'Printer', exact: true })).toContainText(printerName)
  await screenshot(page, 'request-editor-layout')
  await page.getByRole('combobox', { name: 'Printer', exact: true }).click()
  await expect(page.getByRole('option', { name: 'Resin', exact: true })).toHaveCount(0)
  await page.getByRole('option', { name: printerName, exact: true }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  const assignedCard = requestCard(page, 'first-model')
  await expect(assignedCard).toContainText(`Resin - ${printerName}`)
  const printerLabel = assignedCard.getByTitle(printerName)
  await expect(printerLabel).toBeVisible()
  expect(await printerLabel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  const [printerBox, countBox] = await Promise.all([
    printerLabel.boundingBox(),
    assignedCard.getByText('×1', { exact: true }).boundingBox(),
  ])
  expect(printerBox?.y).toBe(countBox?.y)
  await screenshot(page, 'fair-queue-printer-assignment')

  await upload(page, { name: 'oversized-model', printType: 'Resin', buffer: boxStl('oversized-model', 150, 150, 100) })
  await expect(requestCard(page, 'oversized-model').getByLabel('Fits no enabled printer')).toBeVisible({ timeout: 30_000 })
  await screenshot(page, 'oversized-model-alert')

  await page.getByRole('button', { name: 'Filters' }).click()
  const requesterFilter = page.getByPlaceholder('Anyone')
  await requesterFilter.click()
  await page.getByRole('option', { name: /^Owner · \d+$/ }).click()
  await expect(requesterFilter).toHaveValue(/^Owner · \d+$/)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Owner', exact: true })).toBeVisible()
  await screenshot(page, 'requester-filter-labels')

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('link', { name: 'Printers' }).click()
  await expect(page.getByText('Manage the machines available for print assignment.')).toBeVisible()
  await expect(page.getByText('Predefined printer')).toBeVisible()
  await expect
    .poll(() =>
      page
        .getByRole('region', { name: 'Printer 1' })
        .locator('img')
        .evaluate((image) => image.naturalWidth),
    )
    .toBeGreaterThan(0)
  await expect(page.getByLabel(/Usable width|Planning and material assumptions/)).toHaveCount(0)
  await screenshot(page, 'printer-assignment-settings')

  await page.goto('/admin/integrations')
  await page
    .locator('[data-slot="settings-section"]')
    .filter({ hasText: 'Outbound email' })
    .getByRole('button', { name: 'Configure' })
    .click()
  await expect(page.getByLabel('Security')).toContainText('STARTTLS')
  await screenshot(page, 'smtp-security-label')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Open account menu' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('health and protected routes expose security and correlation headers', async ({ request }) => {
  const root = await request.get('/')
  expect(root.headers()['content-security-policy']).toContain("default-src 'self'")
  expect(root.headers()['x-content-type-options']).toBe('nosniff')
  expect(root.headers()['x-frame-options']).toBe('DENY')
  const health = await request.get('/api/health', { headers: { 'x-request-id': 'e2e-health' } })
  expect(health.ok()).toBeTruthy()
  expect(health.headers()['x-request-id']).toBe('e2e-health')
  expect((await request.get('/api/files/missing')).status()).toBe(401)
  expect((await request.get('/api/events')).status()).toBe(401)
})

test('admin routes redirect unauthenticated users', async ({ page }) => {
  await page.goto('/admin/integrations')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('button', { name: /^(Set up PrintHub|Sign in)$/ })).toBeVisible()
})

async function fillPrinter(printer: Locator, values: { name: string; printType: 'Resin' | 'Filament' }) {
  await printer.getByLabel('Printer name').fill(values.name)
  await choose(printer.getByLabel(/Print type for/), values.printType)
}

async function upload(page: Page, values: { name: string; printType: 'Resin' | 'Filament'; buffer: Buffer; quantity?: number }) {
  await page.getByRole('button', { name: 'Add a print' }).click()
  await page.locator('input[type=file]').setInputFiles({ name: `${values.name}.stl`, mimeType: 'model/stl', buffer: values.buffer })
  await page.getByLabel('Name').fill(values.name)
  const printType = page.getByLabel(`Print type for ${values.name}`)
  if (await printType.count()) await choose(printType, values.printType)
  if (values.quantity) await page.getByLabel('Copies').fill(String(values.quantity))
  await page.getByRole('button', { name: 'Add 1 print' }).click()
  await expect(requestCard(page, values.name)).toBeVisible({ timeout: 30_000 })
}

function requestCard(page: Page, name: string) {
  return page.locator('button.card').filter({ hasText: name })
}

async function choose(select: Locator, option: string) {
  await select.click()
  await select.page().getByRole('option', { name: option, exact: true }).click()
  await expect(select).toContainText(option)
}

async function moveCard(page: Page, name: string, from: string, to: string) {
  const card = page.locator(`[data-status="${from}"] .card`).filter({ hasText: name })
  const target = page.locator(`[data-status="${to}"] .column-body`)
  const [cardBox, targetBox] = await Promise.all([card.boundingBox(), target.boundingBox()])
  expect(cardBox).not.toBeNull()
  expect(targetBox).not.toBeNull()
  await page.mouse.move(cardBox!.x + 32, cardBox!.y + 32)
  await page.mouse.down()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 40, { steps: 12 })
  await page.mouse.up()
  const moveDialog = page.getByRole('dialog', { name: 'Move copies' })
  if (await moveDialog.isVisible()) await moveDialog.getByRole('button', { name: 'Move', exact: true }).click()
}

async function screenshot(page: Page, name: string) {
  if (!captureScreenshots) return
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true })
}

async function optimizePageForE2E(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = `
        [data-sonner-toaster] { pointer-events: none !important; }
        *, *::before, *::after {
          animation-delay: 0s !important;
          animation-duration: 0s !important;
          scroll-behavior: auto !important;
          transition-delay: 0s !important;
          transition-duration: 0s !important;
        }
      `
      document.head.append(style)
    })
  })
}
