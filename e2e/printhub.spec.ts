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

  await expect(page.getByText('PrintHub has been updated. Refresh to use the latest version.')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Choose storage' })).toBeVisible()
  await choose(page.getByLabel('Adapter'), 'Remote folder (WebDAV)')
  await expect(page.getByText('A normal folder on hardware you control')).toBeVisible()
  await expect(page.getByLabel('WebDAV endpoint')).toHaveAttribute('placeholder', 'https://storage.example.com/dav')
  await expect(page.getByLabel('Folder')).toHaveValue('printhub')
  await screenshot(page, 'remote-folder-storage')
  await choose(page.getByLabel('Adapter'), 'Local folder')
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
  await expect(page.getByRole('button', { name: 'Sort requests: Requester priorities' })).toContainText('Requester priorities')

  await upload(page, { name: 'first-model', printType: 'Resin', buffer: boxStl('first-model', 10, 10, 10) })
  await upload(page, { name: 'large-order', printType: 'Resin', buffer: boxStl('large-order', 20, 10, 10), quantity: 3 })
  await upload(page, { name: 'bulk-move-a', printType: 'Resin', buffer: boxStl('bulk-move-a', 10, 10, 10), quantity: 2 })
  await upload(page, { name: 'bulk-move-b', printType: 'Resin', buffer: boxStl('bulk-move-b', 10, 10, 10), quantity: 3 })

  await requestCard(page, 'bulk-move-a').click({ modifiers: ['Control'] })
  await requestCard(page, 'bulk-move-b').click({ modifiers: ['Shift'] })
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('2 selected', { exact: true })).toHaveCount(0)

  await requestCard(page, 'bulk-move-a').click({ modifiers: ['Control'] })
  await requestCard(page, 'bulk-move-b').click({ modifiers: ['Control'] })
  await dragCard(page, 'bulk-move-a', 'todo', 'up_next')
  const batchMove = page.getByRole('dialog', { name: 'Move 2 selected requests' })
  await expect(batchMove.getByLabel('Instances of bulk-move-a to move')).toHaveValue('2')
  await batchMove.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  await choose(batchMove.getByLabel('Destination'), 'Up next')
  await batchMove.getByLabel('Instances of bulk-move-a to move').fill('1')
  await screenshot(page, 'bulk-move-desktop')
  await batchMove.getByRole('button', { name: 'Move all' }).click()
  await expect(page.locator('[data-status="todo"] button.card').filter({ hasText: 'bulk-move-a' })).toHaveCount(0)
  await expect(page.locator('[data-status="up_next"] button.card').filter({ hasText: 'bulk-move-a' })).toContainText('×2')
  await expect(page.locator('[data-status="up_next"] button.card').filter({ hasText: 'bulk-move-b' })).toContainText('×3')

  await upload(page, { name: 'bulk-delete-a', printType: 'Resin', buffer: boxStl('bulk-delete-a', 10, 10, 10) })
  await upload(page, { name: 'bulk-delete-b', printType: 'Resin', buffer: boxStl('bulk-delete-b', 10, 10, 10), quantity: 2 })
  await requestCard(page, 'bulk-delete-a').click({ modifiers: ['Control'] })
  await requestCard(page, 'bulk-delete-b').click({ modifiers: ['Control'] })
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const batchDelete = page.getByRole('alertdialog', { name: 'Delete 2 selected requests?' })
  await expect(batchDelete).toContainText('3 affected instances')
  await batchDelete.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await screenshot(page, 'bulk-delete-desktop')
  await batchDelete.getByRole('button', { name: 'Delete requests' }).click()
  await expect(requestCard(page, 'bulk-delete-a')).toHaveCount(0)
  await expect(requestCard(page, 'bulk-delete-b')).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 720 })
  await pressWithMovement(requestCard(page, 'first-model'))
  await expect(page.getByText('1 selected', { exact: true })).toHaveCount(0)
  await longPress(requestCard(page, 'first-model'))
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible()
  await screenshot(page, 'bulk-selection-mobile')
  await page.getByRole('button', { name: 'Clear selection' }).click()
  await page.locator('[data-status="todo"]').getByRole('button', { name: 'Select' }).click()
  await requestCard(page, 'large-order').click()
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  const mobileMove = page.getByRole('dialog', { name: 'Move 1 selected request' })
  const mobileMoveBox = await mobileMove.boundingBox()
  expect(mobileMoveBox?.y).toBeLessThanOrEqual(20)
  expect(mobileMoveBox?.height).toBeGreaterThan(650)
  await screenshot(page, 'bulk-move-mobile')
  await mobileMove.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Clear selection' }).click()
  await page.locator('[data-status="todo"]').getByRole('button', { name: 'Select' }).click()
  await requestCard(page, 'first-model').click()
  await page.locator('[data-status="todo"] header, [data-status="todo"] [data-slot="card-header"]').first().click()
  await expect(page.getByText('1 selected', { exact: true })).toHaveCount(0)

  await page.setViewportSize({ width: 760, height: 480 })
  const pageHeightBeforeSort = await documentHeight(page)
  const sortTrigger = page.getByRole('button', { name: 'Sort requests: Requester priorities' })
  await sortTrigger.focus()
  await sortTrigger.press('Enter')
  const sortMenu = page.getByRole('menu', { name: 'Sort requests' })
  await expectPopoverWithinViewport(page, sortMenu)
  expect(await documentHeight(page)).toBe(pageHeightBeforeSort)
  await expect(page.getByRole('menuitemradio', { name: /Largest|Smallest/ })).toHaveCount(0)
  await expect(page.getByRole('menuitemradio', { name: 'Requester priorities' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitemradio', { name: 'Round robin' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(sortMenu).toBeHidden()
  await expect(sortTrigger).toBeFocused()

  await sortTrigger.press('Space')
  await expect(page.getByRole('menuitemradio', { name: 'Requester priorities' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitemradio', { name: 'Round robin' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitemradio', { name: 'Oldest first' })).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: 'Sort requests: Oldest first' })).toBeFocused()

  const oldestFirstTrigger = page.getByRole('button', { name: 'Sort requests: Oldest first' })
  await oldestFirstTrigger.press('Enter')
  await expect(page.getByRole('menuitemradio', { name: 'Requester priorities' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitemradio', { name: 'Newest first' })).toBeFocused()
  await screenshot(page, 'grouped-sort-options')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Sort requests: Newest first' })).toBeFocused()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(page.locator('[data-status="todo"] button.card').filter({ hasText: 'large-order' })).toBeVisible()
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

  await page.setViewportSize({ width: 760, height: 480 })
  const pageHeightBeforeFilters = await documentHeight(page)
  await page.getByRole('button', { name: 'Filters' }).click()
  await expectPopoverWithinViewport(page, page.locator('[data-slot="popover-content"]'))
  expect(await documentHeight(page)).toBe(pageHeightBeforeFilters)
  await screenshot(page, 'compact-board-filters')
  const requesterFilter = page.getByPlaceholder('Anyone')
  await requesterFilter.click()
  await page.getByRole('option', { name: /^Owner · \d+$/ }).click()
  await expect(requesterFilter).toHaveValue(/^Owner · \d+$/)
  await page.getByRole('button', { name: 'Done' }).click()
  await page.setViewportSize({ width: 1280, height: 720 })
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
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page
    .locator('[data-slot="settings-section"]')
    .filter({ hasText: 'Outbound email' })
    .getByRole('button', { name: 'Configure' })
    .click()
  await expect(page.getByLabel('Security')).toContainText('STARTTLS')
  await expectDialogButtonClickSurvivesScrollbar(page)
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

test('super admin routes redirect unauthenticated users', async ({ page }) => {
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

async function expectPopoverWithinViewport(page: Page, popover: Locator) {
  await expect(popover).toBeVisible()
  const box = await popover.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height)
}

function documentHeight(page: Page) {
  return page.evaluate(() => document.documentElement.scrollHeight)
}

async function moveCard(page: Page, name: string, from: string, to: string) {
  await dragCard(page, name, from, to)
  const moveDialog = page.getByRole('dialog', { name: 'Move copies' })
  if (await moveDialog.isVisible()) await moveDialog.getByRole('button', { name: 'Move', exact: true }).click()
}

async function dragCard(page: Page, name: string, from: string, to: string) {
  const card = page.locator(`[data-status="${from}"] .card`).filter({ hasText: name })
  const target = page.locator(`[data-status="${to}"] .column-body`)
  const [cardBox, targetBox] = await Promise.all([card.boundingBox(), target.boundingBox()])
  expect(cardBox).not.toBeNull()
  expect(targetBox).not.toBeNull()
  await page.mouse.move(cardBox!.x + 32, cardBox!.y + 32)
  await page.mouse.down()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 40, { steps: 12 })
  await page.mouse.up()
}

async function longPress(card: Locator) {
  const box = await card.boundingBox()
  expect(box).not.toBeNull()
  const point = { clientX: box!.x + 20, clientY: box!.y + 20, pointerType: 'touch', pointerId: 1, isPrimary: true }
  await card.dispatchEvent('pointerdown', point)
  await card.page().waitForTimeout(550)
  await card.dispatchEvent('pointerup', point)
}

async function pressWithMovement(card: Locator) {
  const box = await card.boundingBox()
  expect(box).not.toBeNull()
  const point = { clientX: box!.x + 20, clientY: box!.y + 20, pointerType: 'touch', pointerId: 1, isPrimary: true }
  await card.dispatchEvent('pointerdown', point)
  await card.dispatchEvent('pointermove', { ...point, clientX: point.clientX + 20 })
  await card.page().waitForTimeout(550)
  await card.dispatchEvent('pointerup', { ...point, clientX: point.clientX + 20 })
}

async function screenshot(page: Page, name: string) {
  if (!captureScreenshots) return
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true })
}

async function expectDialogButtonClickSurvivesScrollbar(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Configure SMTP' })
  const scrollArea = dialog.locator('.overflow-y-auto')
  const cancelButton = dialog.getByRole('button', { name: 'Cancel' })
  await scrollArea.evaluate((element) => element.setAttribute('data-e2e-scrollbar', ''))
  await page.addStyleTag({
    content: '[data-e2e-scrollbar]::-webkit-scrollbar { width: 24px; }',
  })
  await expect.poll(() => scrollArea.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true)
  await scrollArea.evaluate((element) => {
    element.style.height = `${element.clientHeight}px`
    element.style.flex = 'none'
  })
  await cancelButton.evaluate((element) => {
    element.dataset.clickReceived = 'false'
    element.addEventListener(
      'click',
      (event) => {
        element.dataset.clickReceived = 'true'
        event.preventDefault()
        event.stopPropagation()
      },
      { once: true },
    )
    element.addEventListener(
      'pointerdown',
      () => {
        const spacer = document.createElement('div')
        spacer.dataset.e2eScrollbarSpacer = ''
        spacer.style.height = '1000px'
        spacer.style.flexShrink = '0'
        element.closest('[role="dialog"]')?.querySelector('.overflow-y-auto')?.append(spacer)
      },
      { once: true },
    )
  })
  const buttonBox = await cancelButton.boundingBox()
  expect(buttonBox).not.toBeNull()
  await page.mouse.move(buttonBox!.x + buttonBox!.width - 2, buttonBox!.y + buttonBox!.height / 2)
  await page.mouse.down()
  await expect.poll(() => scrollArea.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await screenshot(page, 'smtp-scrollbar-click')
  await page.mouse.up()
  await expect(cancelButton).toHaveAttribute('data-click-received', 'true')
  await dialog.locator('[data-e2e-scrollbar-spacer]').evaluate((element) => element.remove())
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
