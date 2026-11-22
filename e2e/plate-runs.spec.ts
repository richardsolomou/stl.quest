import fs from 'node:fs/promises'
import path from 'node:path'
import { request as httpRequest, type Locator, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { expect, test } from './fixtures/test'
import { expectWithinViewportWidth } from './fixtures/layout'
import { boxStl } from './fixtures/stl'
import { enterAdminWorkspace } from './fixtures/workspace'

const captureScreenshots = process.env.CAPTURE_E2E_SCREENSHOTS === '1'
const printer = 'Plate run X2D'
const prints = ['plate-run-hull', 'plate-run-turret']
const retries = ['plate-run-retry-a', 'plate-run-retry-b']
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('runs a plate as one and sends it back to print again when Bambuddy reports it failed', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await enterAdminWorkspace(page)

  await page.goto('/settings/board')
  const tracking = page.getByRole('switch', { name: 'Track usage and stock' })
  const wasTracking = await tracking.isChecked()
  if (!wasTracking) {
    await tracking.click()
    await expect(page.getByRole('status').filter({ hasText: /Sav/ })).toHaveText('Saved')
  }

  await page.goto('/settings/printers')
  await page.getByRole('button', { name: 'Add printer', exact: true }).click()
  await page.getByRole('button', { name: 'Custom printer' }).click()
  const printerDialog = page.getByRole('dialog', { name: /printer/i })
  await printerDialog.getByRole('group', { name: 'Print type' }).getByRole('button', { name: 'Filament' }).click()
  await printerDialog.getByLabel('Name', { exact: true }).fill(printer)
  const printerSettings = page.getByRole('dialog', { name: printer })
  await choose(printerSettings.getByRole('combobox', { name: 'Slicer' }), 'OrcaSlicer')
  await printerSettings.getByRole('button', { name: 'Done' }).click()

  await page.goto('/')
  for (const name of prints) await upload(page, name)
  await select(page, prints)
  await startPlateFromSelection(page)
  const start = page.getByRole('dialog', { name: 'Start a plate' })
  await choose(start.getByLabel('Printer'), printer)
  await start.getByRole('button', { name: `Start on ${printer}` }).click()
  const plateNumber = Number((await page.getByText(/^Started plate #\d+ on /).textContent())!.match(/#(\d+)/)![1])

  const station = page.locator('[data-status="in_progress"] [data-station]').filter({ hasText: printer })
  await expect(station.locator(`[data-plate-badge="${plateNumber}"]`)).toHaveCount(2)
  await expect(station.getByRole('button', { name: 'Move plate to Finishing' })).toBeVisible()
  await station.scrollIntoViewIfNeeded()
  await screenshot(page, 'plate-run-station')

  // The plate opens in OrcaSlicer as one 3MF the slicer fetches without the session, every copy named by its tag.
  await page.evaluate(() => {
    const navigation = (window as unknown as { navigation: EventTarget }).navigation
    navigation.addEventListener('navigate', (event) => {
      const navigate = event as Event & { destination: { url: string } }
      if (!navigate.destination.url.startsWith('orcaslicer:')) return
      document.body.dataset.slicerUrl = navigate.destination.url
      event.preventDefault()
    })
  })
  const openPlate = station.locator(`[data-plate="${plateNumber}"]`).getByRole('button', { name: 'Open in OrcaSlicer' })
  await openPlate.click()
  await expect(page.getByText('Opening in OrcaSlicer…')).toBeVisible()
  await screenshot(page, 'plate-run-opening-in-slicer')
  const slicerUrl = new URL((await page.locator('body').getAttribute('data-slicer-url'))!)
  const slicer = await httpRequest.newContext()
  const served = await slicer.get(slicerUrl.searchParams.get('file')!)
  expect(served.status()).toBe(200)
  expect(served.headers()['content-disposition']).toBe(`attachment; filename="stlquest-plate-${plateNumber}.3mf"`)
  // The file is built whole before it is sent, so its length is known up front.
  expect(Number(served.headers()['content-length'])).toBe((await served.body()).byteLength)
  const model = strFromU8(unzipSync(new Uint8Array(await served.body()))['3D/3dmodel.model'])
  expect([...model.matchAll(/<object id="\d+" name="([^"]+)"/g)].map((match) => match[1].replace(/^SQ-\d+ /, 'SQ-n ')).sort()).toEqual(
    prints.map((name) => `SQ-n ${name}.stl`).sort(),
  )
  expect(model.match(/<item /g)).toHaveLength(prints.length)
  await slicer.dispose()
  await expect(page.getByText('Opening in OrcaSlicer…')).toHaveCount(0, { timeout: 10_000 })
  await page.setViewportSize({ width: 320, height: 800 })
  await openPlate.scrollIntoViewIfNeeded()
  await expectWithinViewportWidth(page, openPlate)
  await screenshot(page, 'plate-run-station-mobile')
  await station.getByRole('button', { name: new RegExp(`^Plate #${plateNumber} `) }).click()
  const plateDialog = page.getByRole('dialog', { name: `Plate #${plateNumber}` })
  await expectWithinViewportWidth(page, plateDialog.getByRole('button', { name: 'Open in OrcaSlicer' }))
  await screenshot(page, 'plate-dialog-mobile')
  await page.setViewportSize({ width: 1280, height: 900 })
  await screenshot(page, 'plate-dialog')
  await page.keyboard.press('Escape')
  await expect(plateDialog).toHaveCount(0)

  // Moving one of its cards on its own moves the whole plate.
  await station.getByRole('button', { name: `Off the printer: ${prints[0]}` }).click()
  await expect(page.getByText(`Moved plate #${plateNumber} to Finishing.`)).toBeVisible()
  await expect(page.locator(`[data-status="post_processing"] [data-plate-badge="${plateNumber}"]`)).toHaveCount(2)

  await page.setViewportSize({ width: 320, height: 800 })
  const finishingBadge = page.locator(`[data-status="post_processing"] [data-plate-badge="${plateNumber}"]`).first()
  await finishingBadge.scrollIntoViewIfNeeded()
  await expectWithinViewportWidth(page, finishingBadge)
  await screenshot(page, 'plate-run-finishing-mobile')
  await page.setViewportSize({ width: 1280, height: 900 })
  await page
    .locator('[data-status="post_processing"]')
    .getByRole('button', { name: `Mark ready: ${prints[0]}` })
    .click()
  await expect(page.getByText(`Moved plate #${plateNumber} to Ready.`)).toBeVisible()

  // A failed print on the plate printing there sends its copies back to Up next, flagged with the plate.
  await page.goto('/settings/spoolman')
  const replace = page.getByRole('button', { name: 'Replace token' })
  if (await replace.isVisible()) {
    await replace.click()
    await page.getByRole('alertdialog', { name: 'Replace the token?' }).getByRole('button', { name: 'Replace token' }).click()
  } else await page.getByRole('button', { name: 'Create token' }).click()
  const token = (await page.getByText(/^stlq_spoolman_/).textContent())!
  await page.goto('/')
  for (const name of retries) await upload(page, name)
  await select(page, retries)
  await startPlateFromSelection(page)
  await choose(start.getByLabel('Printer'), printer)
  await start.getByRole('button', { name: `Start on ${printer}` }).click()
  const retried = plateNumber + 1
  await expect(station.locator(`[data-plate-badge="${retried}"]`)).toHaveCount(2)
  const failed = await page.request.post('/api/bambuddy/events', {
    headers: { authorization: `Bearer ${token}` },
    data: { event: 'print_failed', printer, filename: 'plate', duration: '0h 42m', filament_grams: '9.0', progress: '35' },
  })
  expect(failed.status()).toBe(204)
  const upNext = page.locator('[data-status="up_next"]')
  await expect(upNext.getByText(`Plate #${retried} failed`)).toHaveCount(2)
  await screenshot(page, 'plate-run-failed')
  await page.setViewportSize({ width: 320, height: 800 })
  const flag = upNext.getByText(`Plate #${retried} failed`).first()
  await flag.scrollIntoViewIfNeeded()
  await expectWithinViewportWidth(page, flag)
  await screenshot(page, 'plate-run-failed-mobile')
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.goto('/settings/bambuddy')
  await expect(page.getByRole('list', { name: 'Recent prints' })).toContainText(`Plate #${retried}`)
  // The printer counts the failed run, and quotes keep the flat allowance until it has reported enough runs.
  await page.goto('/settings/printers')
  await page.getByRole('button', { name: `Edit ${printer}` }).click()
  const printerFailures = page.getByRole('dialog', { name: printer })
  const failureLine = printerFailures.getByText('1 failed (100%) · Quotes use it from 20 runs')
  await failureLine.scrollIntoViewIfNeeded()
  await screenshot(page, 'plate-run-printer-failures')
  await page.setViewportSize({ width: 320, height: 800 })
  await failureLine.scrollIntoViewIfNeeded()
  await expectWithinViewportWidth(page, failureLine)
  await screenshot(page, 'plate-run-printer-failures-mobile')
  await page.setViewportSize({ width: 1280, height: 900 })
  await printerFailures.getByRole('button', { name: 'Done' }).click()
  await page.goto('/settings/pricing')
  const pricingHint = page.getByText('Stopped prints don’t count, and 0% stays 0%.', { exact: false })
  await pricingHint.scrollIntoViewIfNeeded()
  await screenshot(page, 'pricing-failure-allowance')
  await page.setViewportSize({ width: 320, height: 800 })
  await pricingHint.scrollIntoViewIfNeeded()
  await expectWithinViewportWidth(page, pricingHint)
  await screenshot(page, 'pricing-failure-allowance-mobile')
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/settings/bambuddy')
  await page.setViewportSize({ width: 320, height: 800 })
  await screenshot(page, 'bambuddy-mobile')
  await page.setViewportSize({ width: 1280, height: 900 })

  // The specs after this one share the server and expect one printer with tracking off.
  await page.goto('/')
  for (const name of [...prints, ...retries]) {
    await card(page, name).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page
      .getByRole('alertdialog', { name: `Delete 1 copy of “${name}”?` })
      .getByRole('button', { name: 'Delete copy' })
      .click()
    await expect(card(page, name)).toHaveCount(0)
  }
  await page.goto('/settings/printers')
  await page.getByRole('button', { name: `Edit ${printer}` }).click()
  await page.getByRole('dialog', { name: printer }).getByRole('button', { name: 'Archive', exact: true }).click()
  await page
    .getByRole('alertdialog', { name: `Archive “${printer}”?` })
    .getByRole('button', { name: 'Archive printer' })
    .click()
  await expect(page.getByText('Archived printers', { exact: true })).toBeVisible()
  if (!wasTracking) {
    await page.goto('/settings/board')
    await tracking.click()
    await expect(page.getByRole('status').filter({ hasText: /Sav/ })).toHaveText('Saved')
  }
})

async function select(page: Page, names: string[]) {
  await expect
    .poll(async () => {
      for (const name of names)
        if ((await card(page, name).getAttribute('aria-pressed')) !== 'true') await card(page, name).click({ modifiers: [modifier] })
      return Promise.all(names.map((name) => card(page, name).getAttribute('aria-pressed')))
    })
    .toEqual(names.map(() => 'true'))
}

function card(page: Page, name: string) {
  return page.locator(`button.card[data-request-name="${name}"]`)
}

async function upload(page: Page, name: string) {
  await page.getByRole('region', { name: 'Board filters' }).getByRole('button', { name: 'Add a print' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a print' })
  await dialog.getByRole('button', { name: 'Upload files' }).click()
  await dialog.locator('input[type=file]').setInputFiles({ name: `${name}.stl`, mimeType: 'model/stl', buffer: boxStl(name, 10, 10, 10) })
  await dialog.getByLabel('Name').fill(name)
  const printType = dialog.getByLabel(`Print type for ${name}`)
  if (await printType.count()) await choose(printType, 'Filament')
  await dialog.getByRole('button', { name: 'Add 1 print' }).click()
  await expect(card(page, name)).toBeVisible({ timeout: 30_000 })
}

async function choose(picker: Locator, option: string) {
  await picker.click()
  await picker.page().getByRole('option', { name: option, exact: true }).click()
  await expect(picker).toContainText(option)
}

async function screenshot(page: Page, name: string) {
  if (!captureScreenshots) return
  await page.waitForTimeout(400)
  const directory = path.join(process.cwd(), 'test-results/manual-inspection')
  await fs.mkdir(directory, { recursive: true })
  await page.screenshot({ path: path.join(directory, `${name}.png`) })
}

async function startPlateFromSelection(page: Page) {
  await page.getByRole('toolbar', { name: 'Selection actions' }).getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Start a plate' }).click()
}
