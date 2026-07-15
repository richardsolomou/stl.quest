import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { boxStl } from './fixtures/stl'

const email = 'owner@example.com'
const password = 'correct-horse-battery-staple'
const screenshots = path.join(process.cwd(), 'test-results/manual-inspection')

test.beforeAll(async () => fs.mkdir(screenshots, { recursive: true }))

test('complete resin, FDM, mixed-fleet, settings, and invite journey', async ({ page, browser }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your private 3D-print production queue' })).toBeVisible()
  await expect(page.getByText('Accept STL requests and take resin and FDM prints from upload to collection.')).toBeVisible()
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
    technology: 'Resin',
    width: '130',
    depth: '80',
    height: '160',
  })
  await page.getByRole('button', { name: 'Save printers and finish' }).click()
  await expect(page.getByRole('button', { name: 'Add a print' })).toBeVisible()

  await upload(page, { name: 'resin-cube', technology: 'Resin', printer: 'Resin Station', buffer: boxStl('resin-cube', 10, 10, 10) })
  const resinCard = requestCard(page, 'resin-cube')
  await expect(resinCard).toContainText('Resin')
  await expect(resinCard.getByLabel(/Approximately .* ml/)).toBeVisible({ timeout: 30_000 })
  await expect(resinCard).not.toContainText('Fits selected printer')

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
  await moveCopy(page, 'Queue', 'Printing')
  await moveCopy(page, 'Printing', 'Finishing')
  await moveCopy(page, 'Finishing', 'Ready')
  await expect(page.getByText('1 copies').last()).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('[data-status="done"]')).toContainText('resin-cube')

  await mainNav(page, 'Settings').click()
  await expect(page).toHaveURL(/\/settings\/account$/)
  await expect(page.getByRole('heading', { name: 'Sign-in methods' })).toBeVisible()
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('link', { name: 'Printers' }).click()
  await page.getByRole('button', { name: 'Add printer' }).click()
  await fillPrinter(page.getByRole('region', { name: 'Printer 2' }), {
    name: 'Workshop FDM',
    technology: 'FDM',
    width: '220',
    depth: '220',
    height: '250',
  })
  await page.getByRole('region', { name: 'Printer 2' }).getByText('Planning and material assumptions').click()
  await expect(page.getByLabel('Filament diameter')).toHaveValue('1.75')
  await expect(page.getByLabel('Material density (g/cm³)')).toHaveValue('1.24')
  await page.getByLabel('Material density (g/cm³)').fill('1.25')
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await screenshot(page, 'unsaved-printer-settings-desktop')
  await mobileScreenshot(page, 'unsaved-printer-settings-mobile')
  await page.getByRole('link', { name: 'Storage' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Leave without saving?')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page).toHaveURL(/settings\/printers/)
  await page.getByLabel('Material density (g/cm³)').fill('1.24')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Unsaved changes')).toBeHidden()
  await expect(page.getByText('Printers updated.')).toBeVisible()
  await expect(page.getByText('Printers updated.')).not.toBeVisible({ timeout: 10_000 })
  await screenshot(page, 'mixed-printers-desktop')
  await mobileScreenshot(page, 'mixed-printers-mobile')

  await mainNav(page, 'Board').click()
  await upload(page, { name: 'fdm-block', technology: 'FDM', printer: 'Workshop FDM', buffer: boxStl('fdm-block', 20, 10, 5) })
  const fdmCard = requestCard(page, 'fdm-block')
  await expect(fdmCard).toContainText('FDM')
  await expect(fdmCard.getByLabel(/Approximately .* g/)).toBeVisible({ timeout: 30_000 })
  await expect(fdmCard).not.toContainText('Fits selected printer')
  await fdmCard.click()
  await expect(page.getByText(/≈1.24 g each/)).toBeVisible()
  await expect(page.getByText(/100%-solid equivalent/i)).toBeVisible()
  await expect(page.getByText(/1.75 mm filament at 1.24 g\/cm³/)).toBeVisible()
  await mobileScreenshot(page, 'fdm-request-details-mobile')
  await page.getByRole('button', { name: 'Close' }).click()
  await mobileScreenshot(page, 'mixed-board-mobile')

  await page
    .getByRole('region', { name: 'Board filters' })
    .getByRole('button', { name: /^Filters/ })
    .click()
  await choose(page.getByLabel('Filter by printing technology'), 'FDM')
  await expect(requestCard(page, 'fdm-block')).toBeVisible()
  await expect(page.getByText('resin-cube', { exact: true })).not.toBeVisible()
  await choose(page.getByLabel('Filter by assigned printer'), 'Workshop FDM · FDM')
  await expect(requestCard(page, 'fdm-block')).toBeVisible()
  await page.getByRole('button', { name: 'Clear all' }).click()

  await mainNav(page, 'Planner').click()
  await choose(page.getByLabel('Profile'), 'Resin Station · Resin')
  await expect(page.getByText('No queued models match these filters.')).toBeVisible()
  await choose(page.getByLabel('Profile'), 'Workshop FDM · FDM')
  await expect(page.getByText('Layouts preserve the uploaded orientation')).toBeVisible()
  await expect(page.getByRole('button', { name: 'fdm-block' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'resin-cube' })).not.toBeVisible()
  await verify3mfDownload(page, 'workshop-fdm-plate-1.3mf')
  await mobileScreenshot(page, 'fdm-planner-mobile')

  await choose(page.getByLabel('Profile'), 'Resin Station · Resin')
  await expect(page.getByRole('button', { name: 'fdm-block' })).not.toBeVisible()
  await expect(page.getByText('No queued models match these filters.')).toBeVisible()
  await mainNav(page, 'Board').click()
  await upload(page, { name: 'too-large', technology: 'FDM', buffer: boxStl('too-large', 500, 500, 500) })
  await expect(page.getByLabel('Fits no configured printer')).toBeVisible({ timeout: 30_000 })
  await mainNav(page, 'Planner').click()
  await expect(page.getByText(/queued model does not fit any configured printer/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'too-large' })).toBeVisible()

  await mainNav(page, 'Settings').click()
  await page.getByRole('link', { name: 'Printers' }).click()
  await page.getByRole('button', { name: 'Remove Workshop FDM' }).click()
  await expect(page.getByText('Requests assigned to this printer will remain in the queue and become unassigned.')).toBeVisible()
  await page.getByRole('button', { name: 'Remove printer' }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Printers updated.')).toBeVisible()
  await mainNav(page, 'Board').click()
  await requestCard(page, 'fdm-block').click()
  await expect(page.getByRole('combobox', { name: 'Printer', exact: true })).toContainText('Any compatible printer')
  await expect(page.getByText(/Assign an FDM printer with filament diameter/)).toBeVisible()
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

test('health and metrics expose correlation and operational data', async ({ request }) => {
  const root = await request.get('/')
  expect(root.headers()['content-security-policy']).toContain("default-src 'self'")
  expect(root.headers()['x-content-type-options']).toBe('nosniff')
  expect(root.headers()['x-frame-options']).toBe('DENY')
  const health = await request.get('/api/health', { headers: { 'x-request-id': 'e2e-health' } })
  expect(health.ok()).toBeTruthy()
  expect(health.headers()['x-request-id']).toBe('e2e-health')
  const metrics = await request.get('/api/metrics')
  expect(metrics.ok()).toBeTruthy()
  await expect(metrics.text()).resolves.toContain('printhub_api_requests_total')
  expect((await request.get('/api/files/missing')).status()).toBe(401)
  expect((await request.get('/api/events')).status()).toBe(401)
})

async function fillPrinter(
  printer: Locator,
  values: { name: string; technology: 'Resin' | 'FDM'; width: string; depth: string; height: string },
) {
  await printer.getByLabel('Printer name').fill(values.name)
  await choose(printer.getByLabel(/Technology for/), values.technology)
  await printer.getByLabel('Usable width').fill(values.width)
  await printer.getByLabel('Usable depth').fill(values.depth)
  await printer.getByLabel('Usable height').fill(values.height)
}

async function upload(page: Page, values: { name: string; technology: 'Resin' | 'FDM'; printer?: string; buffer: Buffer }) {
  await page.getByRole('button', { name: 'Add a print' }).click()
  await page.locator('input[type=file]').setInputFiles({ name: `${values.name}.stl`, mimeType: 'model/stl', buffer: values.buffer })
  await page.getByLabel('Name').fill(values.name)
  await choose(page.getByLabel(`Technology for ${values.name}`), values.technology)
  if (values.printer) await choose(page.getByLabel(`Printer for ${values.name}`), values.printer)
  await page.getByRole('button', { name: 'Add 1 print' }).click()
  await expect(requestCard(page, values.name)).toBeVisible()
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

async function moveCopy(page: Page, from: string, to: string) {
  const button = page.getByRole('button', { name: `Move one copy from ${from} to ${to}` })
  if (!(await button.isVisible())) await page.getByText('Manage production copies', { exact: true }).click()
  await button.click()
  await expect(page.getByLabel('Move copies through production').getByText(to, { exact: true })).toBeVisible()
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
