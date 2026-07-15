import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { boxStl } from './fixtures/stl'

const email = 'owner@example.com'
const password = 'correct-horse-battery-staple'
const screenshots = path.join(process.cwd(), 'test-results/manual-inspection')

test.beforeAll(async () => fs.mkdir(screenshots, { recursive: true }))

test('complete resin, filament, fleet-adaptive, settings, and invite journey', async ({ page, browser }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your private 3D-print production queue' })).toBeVisible()
  await expect(page.getByText('Accept STL requests and take resin and filament prints from upload to collection.')).toBeVisible()
  await screenshot(page, 'onboarding-desktop')
  await mobileScreenshot(page, 'onboarding-mobile')

  await page.getByRole('button', { name: 'Set up PrintHub' }).click()
  await page.getByLabel('Name').fill('Owner')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByLabel('Password').press('Enter')
  await expect(page.getByRole('heading', { name: 'Choose storage' })).toBeVisible()
  await page.getByRole('button', { name: 'Finish setup' }).click()
  await expect(page.getByRole('heading', { name: 'Add your printers' })).toBeVisible()
  await page.getByRole('button', { name: 'Add printer' }).click()
  await fillPrinter(page.getByRole('region', { name: 'Printer 1' }), {
    name: 'Resin Station',
    printType: 'Resin',
    width: '130',
    depth: '80',
    height: '160',
  })
  await page.getByRole('button', { name: 'Save printers and finish' }).click()
  await expect(page.getByRole('button', { name: 'Add a print' })).toBeVisible()

  await upload(page, {
    name: 'resin-cube',
    printType: 'Resin',
    buffer: boxStl('resin-cube', 10, 10, 10),
  })
  const resinCard = requestCard(page, 'resin-cube')
  await expect(resinCard).toContainText('Resin')
  await expect(resinCard).not.toContainText('Fits selected printer')
  await mobileScreenshot(page, 'single-resin-board-mobile')
  await resinCard.click()
  await expect(page.getByRole('combobox', { name: 'Print type', exact: true })).toContainText('Resin')
  await mobileScreenshot(page, 'single-resin-request-mobile')
  await page.getByRole('button', { name: 'Close' }).click()
  await page
    .getByRole('region', { name: 'Board filters' })
    .getByRole('button', { name: /^Filters/ })
    .click()
  await expect(page.getByLabel('Filter by print type')).toBeVisible()
  await expect(page.getByLabel('Filter by assigned printer')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close filters' }).click()

  await mainNav(page, 'Planner').click()
  await expect(page.getByText('Layouts use resin orientation analysis')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export 3MF' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'resin-cube' })).toBeVisible()
  await verify3mfDownload(page, 'resin-station-plate-1.3mf')
  await screenshot(page, 'resin-planner-desktop')

  await mainNav(page, 'Board').click()
  await requestCard(page, 'resin-cube').click()
  await expect(page.getByText(/≈1 ml each/)).toBeVisible()
  await expect(page.getByText(/solid model volume/i)).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await moveCard(page, 'resin-cube', 'todo', 'in_progress')
  await moveCard(page, 'resin-cube', 'in_progress', 'post_processing')
  await moveCard(page, 'resin-cube', 'post_processing', 'done')
  await expect(page.locator('[data-status="done"]')).toContainText('resin-cube')

  await mainNav(page, 'Settings').click()
  await expect(page).toHaveURL(/\/settings\/account$/)
  await expect(page.getByRole('heading', { name: 'Sign-in methods' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible()
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('link', { name: 'Printers' }).click()
  await page.getByRole('button', { name: 'Add printer' }).click()
  await fillPrinter(page.getByRole('region', { name: 'Printer 2' }), {
    name: 'Workshop Filament',
    printType: 'Filament',
    width: '220',
    depth: '220',
    height: '250',
  })
  await page.getByRole('region', { name: 'Printer 2' }).getByText('Planning and material assumptions').click()
  await expect(page.getByLabel('Filament diameter')).toHaveValue('1.75')
  await expect(page.getByLabel('Material density (g/cm³)')).toHaveValue('1.24')
  await page.getByLabel('Material density (g/cm³)').fill('1.25')
  await page.getByRole('button', { name: 'Add printer' }).click()
  await fillPrinter(page.getByRole('region', { name: 'Printer 3' }), {
    name: 'Resin Backup',
    printType: 'Resin',
    width: '130',
    depth: '80',
    height: '160',
  })
  await page.getByRole('link', { name: 'Storage' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Leave without saving?')
  await screenshot(page, 'unsaved-settings-confirmation-desktop')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page).toHaveURL(/settings\/printers/)
  await page.getByLabel('Material density (g/cm³)').fill('1.24')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Printers updated.').last()).toBeVisible()
  await expect(page.getByText('Printers updated.')).not.toBeVisible({ timeout: 10_000 })
  const resinAssumptions = page.getByRole('region', { name: 'Printer 1' }).locator('details')
  await resinAssumptions.getByLabel('Planning and material assumptions').click()
  await page.setViewportSize({ width: 1365, height: 768 })
  await expect.poll(() => resinAssumptions.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await resinAssumptions.screenshot({ path: path.join(screenshots, 'resin-assumptions-responsive.png') })
  await page.setViewportSize({ width: 1280, height: 800 })
  await resinAssumptions.getByLabel('Planning and material assumptions').click()
  await screenshot(page, 'mixed-printers-desktop')
  await mobileScreenshot(page, 'mixed-printers-mobile')

  await mainNav(page, 'Board').click()
  await expect(requestCard(page, 'resin-cube')).toContainText('Resin')
  await upload(page, {
    name: 'filament-block',
    printType: 'Filament',
    buffer: boxStl('filament-block', 20, 10, 5),
  })
  const filamentCard = requestCard(page, 'filament-block')
  await expect(filamentCard).toContainText('Filament')
  await expect(filamentCard).not.toContainText('Fits selected printer')
  await filamentCard.click()
  await expect(page.getByRole('heading', { name: 'filament-block' })).toBeVisible({ timeout: 1_000 })
  await expect(page.getByText(/≈1.24 g each/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/100%-solid equivalent/i)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/material density of 1.24 g\/cm³/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('combobox', { name: 'Print type', exact: true })).toContainText('Filament')
  const longTitle = 'A very long descriptive print title that should stay readable without pushing the dialog beyond the viewport'
  await page.getByLabel('Name').fill(longTitle)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await requestCard(page, longTitle).click()
  const dialogTitle = page.getByRole('heading', { name: longTitle })
  await expect(dialogTitle).toBeVisible({ timeout: 1_000 })
  await expect
    .poll(() =>
      dialogTitle.evaluate((element) => ({
        clipped: element.scrollWidth > element.clientWidth,
        overflow: getComputedStyle(element).textOverflow,
        whiteSpace: getComputedStyle(element).whiteSpace,
      })),
    )
    .toEqual({ clipped: true, overflow: 'ellipsis', whiteSpace: 'nowrap' })
  await mobileScreenshot(page, 'filament-request-details-mobile')
  await page.getByLabel('Name').fill('filament-block')
  await page.getByRole('button', { name: 'Save changes' }).click()

  await upload(page, {
    name: 'pooled-filament',
    printType: 'Filament',
    buffer: boxStl('pooled-filament', 10, 10, 10),
  })
  const pooledFilamentCard = requestCard(page, 'pooled-filament')
  await pooledFilamentCard.click()
  await expect(page.getByText(/≈1.24 g each/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Assigned printer does not fit; another enabled printer does')).toHaveCount(0)
  await screenshot(page, 'pooled-compatible-request-desktop')
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(pooledFilamentCard.getByLabel('Assigned printer does not fit')).toHaveCount(0)
  await screenshot(page, 'mixed-board-desktop')
  await mobileScreenshot(page, 'mixed-board-mobile')

  await mainNav(page, 'Settings').click()
  await page.getByRole('link', { name: 'Printers' }).click()
  const filamentEnabled = page.getByRole('region', { name: 'Printer 2' }).getByRole('switch', { name: 'Enabled' })
  await filamentEnabled.click()
  await expect(filamentEnabled).not.toBeChecked()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Printers updated.').last()).toBeVisible()
  await expect(page.getByText('Printers updated.')).not.toBeVisible({ timeout: 10_000 })

  await mainNav(page, 'Board').click()
  await requestCard(page, 'filament-block').click()
  await expect(page.getByRole('combobox', { name: 'Print type', exact: true })).toContainText('Filament')
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Add a print' }).click()
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'new-target.stl', mimeType: 'model/stl', buffer: boxStl('new-target', 10, 10, 10) })
  const printType = page.getByLabel('Print type for new target')
  await printType.click()
  await expect(page.locator('[data-slot="select-content"]')).toBeVisible()
  await expect(page.getByRole('option', { name: 'Filament', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-slot="select-content"]')).not.toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Discard' }).click()

  await mainNav(page, 'Planner').click()
  await expect(page.getByRole('heading', { name: 'Printer' })).toBeVisible()
  await page.getByLabel('Printer', { exact: true }).click()
  await expect(page.getByRole('option', { name: /Workshop Filament/ })).toHaveCount(0)
  await page.getByRole('option', { name: /Resin Station/ }).click()
  await expect(page.locator('[data-slot="select-content"]')).not.toBeVisible()

  await mainNav(page, 'Settings').click()
  await page.getByRole('link', { name: 'Printers' }).click()
  const restoredFilamentEnabled = page.getByRole('region', { name: 'Printer 2' }).getByRole('switch', { name: 'Enabled' })
  await restoredFilamentEnabled.click()
  await expect(restoredFilamentEnabled).toBeChecked()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Printers updated.').last()).toBeVisible()
  await expect(page.getByText('Printers updated.')).not.toBeVisible({ timeout: 10_000 })
  await mainNav(page, 'Board').click()
  const restoredFilamentCard = requestCard(page, 'filament-block')
  await expect(restoredFilamentCard).toBeVisible()
  await expect(restoredFilamentCard).toContainText('Filament')

  await page
    .getByRole('region', { name: 'Board filters' })
    .getByRole('button', { name: /^Filters/ })
    .click()
  await choose(page.getByLabel('Filter by print type'), 'Filament')
  await expect(requestCard(page, 'filament-block')).toBeVisible()
  await expect(page.getByText('resin-cube', { exact: true })).not.toBeVisible()
  await expect(page.getByLabel('Filter by assigned printer')).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear all' }).click()

  await mainNav(page, 'Planner').click()
  await choose(page.getByLabel('Printer', { exact: true }), 'Workshop Filament · Filament · 1 plate')
  await expect(page.getByText('Layouts preserve the uploaded orientation')).toBeVisible()
  await expect(page.getByRole('button', { name: 'filament-block' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'resin-cube' })).not.toBeVisible()
  await verify3mfDownload(page, 'workshop-filament-plate-1.3mf')
  await screenshot(page, 'filament-planner-desktop')
  await mobileScreenshot(page, 'filament-planner-mobile')

  await mainNav(page, 'Board').click()
  await upload(page, {
    name: 'too-large',
    printType: 'Filament',
    buffer: boxStl('too-large', 500, 500, 500),
  })
  await expect(page.getByLabel('Fits no enabled printer')).toBeVisible({ timeout: 30_000 })
  await mainNav(page, 'Planner').click()
  await expect(page.getByText(/queued model does not fit any enabled printer/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'too-large' })).toBeVisible()

  await mainNav(page, 'Settings').click()
  await page.getByRole('link', { name: 'Printers' }).click()
  await removePrinter(page, 'Resin Station')
  await removePrinter(page, 'Resin Backup')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Printers updated.')).toBeVisible()
  await mainNav(page, 'Board').click()
  await expect.poll(() => page.getByText('Printers updated.').count(), { timeout: 10_000 }).toBe(0)
  await expect(requestCard(page, 'filament-block')).toContainText('Filament')
  await requestCard(page, 'filament-block').click()
  await expect(page.getByRole('combobox', { name: 'Print type', exact: true })).toContainText('Filament')
  await mobileScreenshot(page, 'single-filament-request-mobile')
  await page.getByRole('button', { name: 'Close' }).click()

  await mainNav(page, 'Settings').click()
  await page.getByRole('link', { name: 'Printers' }).click()
  await page.getByRole('button', { name: 'Add printer' }).click()
  await fillPrinter(page.getByRole('region', { name: 'Printer 2' }), {
    name: 'Resin Station',
    printType: 'Resin',
    width: '130',
    depth: '80',
    height: '160',
  })
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Printers updated.')).toBeVisible()
  await expect.poll(() => page.getByText('Printers updated.').count(), { timeout: 10_000 }).toBe(0)
  await removePrinter(page, 'Workshop Filament')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Printers updated.')).toBeVisible()
  await mainNav(page, 'Board').click()
  await expect(requestCard(page, 'filament-block').getByLabel('Fits no enabled printer')).toBeVisible()
  await requestCard(page, 'filament-block').click()
  await expect(page.getByRole('combobox', { name: 'Print type', exact: true })).toContainText('Filament')
  await expect(page.getByText(/Configure at least one filament printer/)).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()

  await mainNav(page, 'Settings').click()
  await page.getByRole('link', { name: 'Users' }).click()
  await page.getByRole('button', { name: 'Add user' }).click()
  await expect(page.getByRole('heading', { name: 'Create user' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Invite user' }).click()
  await expect(page.getByRole('heading', { name: 'Create invite link' })).toBeVisible()
  await page.getByRole('button', { name: 'Create invite link' }).click()
  const inviteUrl = await page.locator('#invite-link').inputValue()
  const inviteContext = await browser.newContext()
  const invitePage = await inviteContext.newPage()
  await invitePage.goto(inviteUrl)
  await expect(invitePage.getByRole('heading', { name: "You're invited" })).toBeVisible()
  await expect(invitePage.locator('form[data-hydrated="true"]')).toBeVisible()
  await invitePage.getByLabel('Name').fill('Requester')
  await invitePage.getByLabel('Email').fill('requester@example.com')
  await invitePage.getByLabel('Password').fill(password)
  await invitePage.getByRole('button', { name: 'Create account' }).click()
  await expect(invitePage.getByRole('button', { name: 'Add a print' })).toBeVisible()
  await mainNav(invitePage, 'Settings').click()
  await expect(invitePage.getByRole('navigation', { name: 'Settings sections' }).getByRole('link')).toHaveCount(1)
  await inviteContext.close()

  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('link', { name: 'Account' }).click()
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

async function fillPrinter(
  printer: Locator,
  values: { name: string; printType: 'Resin' | 'Filament'; width: string; depth: string; height: string },
) {
  await printer.getByLabel('Printer name').fill(values.name)
  await choose(printer.getByLabel(/Print type for/), values.printType)
  await printer.getByLabel('Usable width').fill(values.width)
  await printer.getByLabel('Usable depth').fill(values.depth)
  await printer.getByLabel('Usable height').fill(values.height)
}

async function removePrinter(page: Page, name: string) {
  await page.getByRole('button', { name: `Remove ${name}` }).click()
  await page.getByRole('button', { name: 'Remove printer' }).click()
}

async function upload(
  page: Page,
  values: {
    name: string
    printType: 'Resin' | 'Filament'
    buffer: Buffer
  },
) {
  await page.getByRole('button', { name: 'Add a print' }).click()
  await page.locator('input[type=file]').setInputFiles({ name: `${values.name}.stl`, mimeType: 'model/stl', buffer: values.buffer })
  await page.getByLabel('Name').fill(values.name)
  const printType = page.getByLabel(`Print type for ${values.name}`)
  await expect(printType).toBeVisible()
  await choose(printType, values.printType)
  await page.getByRole('button', { name: 'Add 1 print' }).click()
  await expect(requestCard(page, values.name)).toBeVisible({ timeout: 30_000 })
}

function requestCard(page: Page, name: string) {
  return page.locator('button.card').filter({ hasText: name })
}

function mainNav(page: Page, name: 'Board' | 'Planner' | 'Settings') {
  return page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true })
}

async function choose(select: Locator, option: string) {
  await select.click()
  await select.page().getByRole('option', { name: option, exact: true }).click()
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
  await expect(page.locator(`[data-status="${to}"] .card`).filter({ hasText: name })).toBeVisible()
}

async function verify3mfDownload(page: Page, expectedName: string) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export 3MF' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(expectedName)
  const file = await download.path()
  expect(file).toBeTruthy()
  const archive = unzipSync(new Uint8Array(await fs.readFile(file)))
  expect(strFromU8(archive['3D/3dmodel.model'])).toContain('<model')
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true })
}

async function mobileScreenshot(page: Page, name: string) {
  const original = page.viewportSize() ?? { width: 1280, height: 800 }
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await screenshot(page, name)
  await page.setViewportSize(original)
}
