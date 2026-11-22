import fs from 'node:fs/promises'
import path from 'node:path'
import { request as httpRequest, type Locator, type Page } from '@playwright/test'
import { expect, test } from './fixtures/test'
import { expectWithinViewportWidth } from './fixtures/layout'
import { boxStl } from './fixtures/stl'
import { enterAdminWorkspace } from './fixtures/workspace'

const captureScreenshots = process.env.CAPTURE_E2E_SCREENSHOTS === '1'

test('opens a print in its printer’s slicer through a link that works without the session', async ({ page, baseURL }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await enterAdminWorkspace(page)

  await page.goto('/settings/printers')
  await page.getByRole('button', { name: 'Add printer', exact: true }).click()
  await page.getByRole('button', { name: 'Custom printer' }).click()
  const printerDialog = page.getByRole('dialog', { name: /printer/i })
  await printerDialog.getByRole('group', { name: 'Print type' }).getByRole('button', { name: 'Filament' }).click()
  await printerDialog.getByLabel('Name', { exact: true }).fill('Slicer printer')
  const dialog = page.getByRole('dialog', { name: 'Slicer printer' })
  await choose(dialog.getByRole('combobox', { name: 'Slicer' }), 'OrcaSlicer')
  await expect(dialog.getByText('Prints open straight in OrcaSlicer.')).toBeVisible()
  await screenshot(page, 'printer-slicer-setting')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)

  const model = boxStl('slicer-model', 12, 12, 12)
  await page.goto('/')
  await page.getByRole('region', { name: 'Board filters' }).getByRole('button', { name: 'Add a print' }).click()
  const upload = page.getByRole('dialog', { name: 'Add a print' })
  await upload.getByRole('button', { name: 'Upload files' }).click()
  await upload.locator('input[type=file]').setInputFiles({ name: 'slicer-model.stl', mimeType: 'model/stl', buffer: model })
  await upload.getByLabel('Name').fill('slicer-model')
  const printType = upload.getByLabel('Print type for slicer-model')
  if (await printType.count()) await choose(printType, 'Filament')
  await upload.getByRole('button', { name: 'Add 1 print' }).click()
  const card = page.locator('button.card[data-request-name="slicer-model"]')
  await expect(card).toBeVisible({ timeout: 30_000 })

  await card.click()
  const requestDialog = page.getByRole('dialog', { name: 'slicer-model' })
  await requestDialog.getByRole('button', { name: 'Edit' }).click()
  await choose(requestDialog.getByRole('combobox', { name: 'Printer', exact: true }), 'Slicer printer')
  await requestDialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(requestDialog).toHaveCount(0)
  await card.click()

  const open = requestDialog.getByRole('button', { name: 'Open in OrcaSlicer' })
  await expect(open).toBeVisible()
  await expect.poll(() => open.locator('img').evaluate((logo: HTMLImageElement) => logo.naturalWidth)).toBeGreaterThan(0)
  await screenshot(page, 'request-open-in-slicer')
  await page.setViewportSize({ width: 320, height: 720 })
  await expectWithinViewportWidth(page, open)
  await screenshot(page, 'request-open-in-slicer-320')
  await page.setViewportSize({ width: 1280, height: 800 })

  // The browser hands the custom scheme to the operating system, so the page records where it was sent instead.
  await page.evaluate(() => {
    const navigation = (window as unknown as { navigation: EventTarget }).navigation
    navigation.addEventListener('navigate', (event) => {
      const navigate = event as Event & { destination: { url: string } }
      if (!navigate.destination.url.startsWith('orcaslicer:')) return
      document.body.dataset.slicerUrl = navigate.destination.url
      event.preventDefault()
    })
  })
  await open.click()
  await expect(page.getByText('Opening in OrcaSlicer…')).toBeVisible()
  await expect(page.getByText('It is added to the plate that is already open.')).toBeVisible()
  await screenshot(page, 'request-opening-in-slicer')
  const slicerUrl = new URL((await page.locator('body').getAttribute('data-slicer-url'))!)
  const fileUrl = new URL(slicerUrl.searchParams.get('file')!)
  expect(fileUrl.origin).toBe(new URL(baseURL!).origin)

  const slicer = await httpRequest.newContext()
  const served = await slicer.get(fileUrl.href)
  expect(served.status()).toBe(200)
  expect(served.headers()['content-disposition']).toMatch(/^attachment; filename="SQ-\d+ slicer-model\.stl"$/)
  expect(Buffer.compare(await served.body(), model)).toBe(0)
  const tampered = new URL(fileUrl)
  tampered.pathname = tampered.pathname.replace(/[^/]$/, (last) => (last === 'A' ? 'B' : 'A'))
  expect((await slicer.get(tampered.href)).status()).toBe(404)
  await slicer.dispose()

  const download = page.waitForEvent('download')
  await requestDialog.getByRole('link', { name: 'Download model' }).click()
  expect((await download).suggestedFilename()).toMatch(/^SQ-\d+ slicer-model\.stl$/)
})

async function choose(select: Locator, option: string) {
  await select.click()
  await select.page().getByRole('option', { name: option, exact: true }).click()
  await expect(select).toContainText(option)
}

async function screenshot(page: Page, name: string) {
  if (!captureScreenshots) return
  await page.waitForTimeout(400)
  const directory = path.join(process.cwd(), 'test-results/manual-inspection')
  await fs.mkdir(directory, { recursive: true })
  await page.screenshot({ path: path.join(directory, `${name}.png`) })
}
