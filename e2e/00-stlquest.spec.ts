import fs from 'node:fs/promises'
import os from 'node:os'
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
  const multipleSelectionModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  const printerName = 'Resin Station With A Long Descriptive Name'
  await optimizePageForE2E(page)
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Get source code' })).toHaveAttribute(
    'href',
    'https://github.com/richardsolomou/stl.quest/tree/main',
  )
  await screenshot(page, 'auth-source-offer')
  await page.getByRole('button', { name: 'Set up STL Quest' }).click()
  await page.getByLabel('Name').fill('Owner')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByLabel('Password').press('Enter')

  await expect(page.getByText('STL Quest has been updated. Refresh to use the latest version.')).toHaveCount(0)
  const storageHeading = page.getByRole('heading', { name: 'Choose where your models live' })
  await expect(storageHeading).toBeVisible()
  expect((await storageHeading.boundingBox())?.y).toBeGreaterThanOrEqual(0)
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0)
  await screenshot(page, 'storage-provider-picker')
  const storageFooter = page.getByText('Storage can move later from Settings.')
  await page.locator('main').evaluate((scroller) => scroller.scrollTo({ top: scroller.scrollHeight }))
  const storageFooterBox = await storageFooter.boundingBox()
  expect(storageFooterBox && storageFooterBox.y + storageFooterBox.height).toBeLessThanOrEqual(720)
  // Scrolled to the end, the card still clears the viewport edge, so neither end of a tall step is ever flush against it.
  const storageCardBox = await page.locator('[data-slot="card"]').boundingBox()
  expect(storageCardBox && storageCardBox.y + storageCardBox.height).toBeLessThan(720)
  await screenshot(page, 'storage-provider-picker-footer')
  // A super admin is the administrator, so an unregistered provider offers its one-time setup rather than being withheld.
  await expect(page.getByText('Consumer cloud storage')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Box', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'OneDrive' }).click()
  await expect(page.getByRole('button', { name: 'Connect my OneDrive' })).toBeDisabled()
  await page.getByRole('button', { name: 'Set up the OneDrive app' }).click()
  const cloudAppDialog = page.getByRole('dialog', { name: 'Set up the OneDrive app' })
  await expect(cloudAppDialog.getByText('Any Entra ID Tenant + Personal Microsoft accounts', { exact: false })).toBeVisible()
  await expect(cloudAppDialog.getByText('/api/storage/onedrive/callback')).toBeVisible()
  await screenshot(page, 'cloud-app-setup-from-storage')
  await cloudAppDialog.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'All storage options' }).click()
  await page.getByRole('button', { name: 'Pick another folder' }).click()
  await expect(page.getByRole('heading', { name: 'Set up a folder on this server' })).toBeVisible()
  const onboardingFolder = page.getByLabel('Folder')
  const defaultFolder = await onboardingFolder.inputValue()
  const populatedFolder = path.join(os.tmpdir(), 'stlquest-onboarding-populated')
  await fs.mkdir(populatedFolder, { recursive: true })
  await fs.writeFile(path.join(populatedFolder, 'existing.txt'), 'existing')
  await onboardingFolder.fill(populatedFolder)
  await page.getByRole('button', { name: 'Save and continue' }).click()
  const onboardingReview = page.getByRole('alertdialog', { name: 'That folder is not empty' })
  await expect(onboardingReview).toBeVisible()
  await onboardingReview.getByRole('button', { name: 'Cancel' }).click()
  await onboardingFolder.fill(defaultFolder)
  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.getByText('Connection verified')).toBeVisible()
  await screenshot(page, 'storage-onboarding-verified')
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(page.getByRole('heading', { name: 'Add the printers you own' })).toBeVisible()
  await expect(page.getByText('Step 2 of 2')).toBeVisible()
  // Saved storage is not a one-way door: the printers step goes back, and the storage step offers to keep what is already set.
  await page.getByRole('button', { name: 'Back to storage' }).click()
  await expect(page.getByRole('heading', { name: 'Change where your models live' })).toBeVisible()
  await expect(page.getByText(defaultFolder, { exact: true })).toBeVisible()
  await screenshot(page, 'storage-reopened')
  await page.getByRole('button', { name: 'Keep this and continue' }).click()
  await expect(page.getByRole('heading', { name: 'Add the printers you own' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('heading', { name: 'Your production queue is ready' })).toBeVisible()
  // Skipping printers is a recorded decision, so reloading must not ask for them again.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your production queue is ready' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Add the printers you own' })).toHaveCount(0)
  const questButton = page.getByRole('button', { name: 'STL Quest, 1 of 7 resolved, 10 XP' })
  await expect(questButton).toBeVisible()
  await questButton.click()
  await expect(page.getByRole('heading', { name: 'Learn by doing' })).toBeVisible()
  await expect(page.getByText('1 of 7 quests resolved · 10 of 100 XP earned')).toBeVisible()
  await screenshot(page, 'product-quest-list')
  await page.getByRole('button', { name: 'Skip Add your first print' }).click()
  await expect(page.getByRole('button', { name: 'Restore Add your first print' })).toBeVisible()
  await page.getByRole('button', { name: 'Restore Add your first print' }).click()
  await expect(page.getByText('1 of 7 quests resolved · 10 of 100 XP earned')).toBeVisible()
  await page.keyboard.press('Escape')
  const tour = page.getByRole('note', { name: 'STL Quest' })
  await expect(tour.getByRole('heading', { name: 'Add your first print' })).toBeVisible()
  await expect(tour.getByText('+20 XP')).toBeVisible()
  await expect(tour.getByText('drag files anywhere onto the board', { exact: false })).toBeVisible()
  await screenshot(page, 'product-tour-board')
  await page.getByRole('button', { name: 'Add a print' }).click()
  const uploadDialog = page.getByRole('dialog', { name: 'Add prints' })
  await expect(uploadDialog).toBeVisible()
  await uploadDialog.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Filters' }).click()
  await expect(page.getByText('More filters', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close filters' }).click()
  const boardViewers = page.getByLabel('1 person viewing this board')
  await expect(boardViewers).toBeVisible()
  await boardViewers.locator('[data-slot="avatar"]').hover()
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('Owner')
  await screenshot(page, 'board-presence')
  await page.getByRole('button', { name: /STL Quest/ }).click()
  await page.getByRole('button', { name: /Inspect model storage/ }).click()
  await page.goto('/settings/storage?cloud=onedrive&outcome=connected')
  await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible()
  await expect(tour.getByRole('heading', { name: 'Inspect model storage' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Switch to OneDrive' })).toBeVisible()
  await expect(page.getByText('OneDrive is connected')).toBeVisible()
  await expect(page.getByText('Save storage to create this workspace’s folder.')).toBeVisible()
  await expect(page).toHaveURL('/settings/storage')
  await screenshot(page, 'cloud-storage-oauth-return')
  await page.getByRole('button', { name: 'All storage options' }).click()
  await page.getByRole('button', { name: /Remote folder over WebDAV/ }).click()
  await expect(page.getByText('A normal folder on hardware you control')).toBeVisible()
  await expect(page.getByLabel('WebDAV endpoint')).toHaveAttribute('placeholder', 'https://storage.example.com/dav')
  await expect(page.getByLabel('Folder')).toHaveValue('stlquest')
  await expect(page.getByRole('link', { name: 'Set up remote WebDAV' })).toHaveAttribute(
    'href',
    'https://github.com/richardsolomou/stl.quest/blob/main/docs/webdav.md',
  )
  await screenshot(page, 'remote-folder-storage')
  await page.getByRole('button', { name: 'All storage options' }).click()
  await page.getByRole('button', { name: 'Edit current storage' }).click()
  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.getByText('Connection verified')).toBeVisible()
  await screenshot(page, 'storage-connection-verified')
  await page.getByRole('button', { name: 'Save storage' }).click()
  await expect(page.getByRole('button', { name: 'No storage changes' })).toBeVisible()
  await page.getByRole('link', { name: 'Printers' }).click()
  await expect(page.getByRole('heading', { name: 'Printers' })).toBeVisible()
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
  const presetPrinter = page.getByRole('row', { name: 'Printer 1' })
  await expect(presetPrinter.getByLabel('Printer name')).toHaveValue('Elegoo Mars 2')
  await expect.poll(() => presetPrinter.locator('img').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)
  await screenshot(page, 'selected-printer-image')
  await expect(page.getByLabel(/Usable width|Usable depth|Usable height/)).toHaveCount(0)
  await fillPrinter(presetPrinter, { name: printerName, printType: 'Resin' })
  await page.getByRole('button', { name: 'Save printers' }).click()
  await page.goto('/')

  await expect(page.getByRole('link', { name: 'Planner' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sort requests: Requester priorities' })).toContainText('Requester priorities')

  let releaseThumbnail!: () => void
  const delayedThumbnail = new Promise<void>((resolve) => {
    releaseThumbnail = resolve
  })
  let thumbnailDelayed = false
  await page.route('**/api/thumbs/**', async (route) => {
    if (thumbnailDelayed) return await route.continue()
    thumbnailDelayed = true
    await delayedThumbnail
    await route.continue()
  })
  await upload(page, { name: 'first-model', printType: 'Resin', buffer: boxStl('first-model', 10, 10, 10) })
  const firstThumbnail = requestCard(page, 'first-model')
  await expect(firstThumbnail.getByLabel('Loading thumbnail')).toBeVisible({ timeout: 30_000 })
  await screenshot(page, 'thumbnail-loading')
  releaseThumbnail()
  await expect(firstThumbnail.getByLabel('Loading thumbnail')).toHaveCount(0)
  await expect.poll(() => firstThumbnail.locator('img[src*="/api/thumbs/"]').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)
  await page.unroute('**/api/thumbs/**')
  await upload(page, { name: 'large-order', printType: 'Resin', buffer: boxStl('large-order', 20, 10, 10), quantity: 3 })
  await upload(page, { name: 'bulk-move-a', printType: 'Resin', buffer: boxStl('bulk-move-a', 10, 10, 10), quantity: 2 })
  await upload(page, { name: 'bulk-move-b', printType: 'Resin', buffer: boxStl('bulk-move-b', 10, 10, 10), quantity: 3 })
  await upload(page, { name: 'bulk-move-single-a', printType: 'Resin', buffer: boxStl('bulk-move-single-a', 10, 10, 10) })
  await upload(page, { name: 'bulk-move-single-b', printType: 'Resin', buffer: boxStl('bulk-move-single-b', 10, 10, 10) })
  await upload(page, { name: 'bulk-move-single-c', printType: 'Resin', buffer: boxStl('bulk-move-single-c', 10, 10, 10) })

  await requestCard(page, 'bulk-move-a').click({ modifiers: [multipleSelectionModifier] })
  await requestCard(page, 'bulk-move-b').click({ modifiers: ['Shift'] })
  await expect(page.getByText('2 selected', { exact: true })).toBeHidden()
  await expect(page.locator('button.card[aria-pressed="true"]')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(page.getByText('2 selected', { exact: true })).toHaveCount(0)

  await requestCard(page, 'bulk-move-single-a').click({ modifiers: [multipleSelectionModifier] })
  await requestCard(page, 'bulk-move-single-b').click({ modifiers: [multipleSelectionModifier] })
  await requestCard(page, 'bulk-move-single-a').click({ button: 'right' })
  const batchDownloadPromise = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Download STLs' }).click()
  const batchDownload = await batchDownloadPromise
  expect(batchDownload.suggestedFilename()).toBe('stlquest-models.zip')
  const batchArchive = await fs.readFile(await batchDownload.path())
  expect(batchArchive.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  expect(batchArchive.includes(Buffer.from('bulk-move-single-a.stl'))).toBe(true)
  expect(batchArchive.includes(Buffer.from('bulk-move-single-b.stl'))).toBe(true)
  await requestCard(page, 'bulk-move-single-a').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click()
  const singleBatchMove = page.getByRole('dialog', { name: 'Move 2 selected requests' })
  await screenshot(page, 'bulk-move-single-destination')
  await choose(singleBatchMove.getByLabel('Destination'), 'Up next')
  await singleBatchMove.getByRole('button', { name: 'Move all' }).click()
  await expect(singleBatchMove).toHaveCount(0)
  await expect(page.locator('[data-status="up_next"] button.card').filter({ hasText: 'bulk-move-single-a' })).toBeVisible()
  await expect(page.locator('[data-status="up_next"] button.card').filter({ hasText: 'bulk-move-single-b' })).toBeVisible()
  await requestCard(page, 'first-model').click({ modifiers: [multipleSelectionModifier] })
  await requestCard(page, 'bulk-move-single-a').click({ modifiers: [multipleSelectionModifier] })
  await expect(page.locator('button.card[aria-pressed="true"]')).toHaveCount(2)
  await requestCard(page, 'first-model').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Add to group' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Download STLs' })).toBeVisible()
  await screenshot(page, 'cross-column-selection')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('button.card[aria-pressed="true"]')).toHaveCount(0)
  await requestCard(page, 'bulk-move-single-a').click({ modifiers: [multipleSelectionModifier] })
  await requestCard(page, 'bulk-move-single-b').click({ modifiers: [multipleSelectionModifier] })
  await dragCard(page, 'bulk-move-single-a', 'up_next', 'todo')
  await expect(page.getByRole('dialog', { name: 'Move 2 selected requests' })).toHaveCount(0)
  await expect(page.locator('[data-status="todo"] button.card').filter({ hasText: 'bulk-move-single-a' })).toBeVisible()
  await expect(page.locator('[data-status="todo"] button.card').filter({ hasText: 'bulk-move-single-b' })).toBeVisible()

  await requestCard(page, 'bulk-move-a').click({ modifiers: [multipleSelectionModifier] })
  await requestCard(page, 'bulk-move-b').click({ modifiers: [multipleSelectionModifier] })
  await requestCard(page, 'bulk-move-single-c').click({ modifiers: [multipleSelectionModifier] })
  await dragCard(page, 'bulk-move-a', 'todo', 'up_next')
  const batchMove = page.getByRole('dialog', { name: 'Move 3 selected requests' })
  await expect(batchMove.getByLabel('Instances of bulk-move-a to move')).toHaveValue('2')
  await expect(batchMove.getByText('bulk-move-single-c')).toHaveCount(0)
  await batchMove.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('3 selected', { exact: true })).toBeHidden()
  await expect(page.locator('button.card[aria-pressed="true"]')).toHaveCount(3)
  await requestCard(page, 'bulk-move-a').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click()
  await choose(batchMove.getByLabel('Destination'), 'Up next')
  await batchMove.getByLabel('Instances of bulk-move-a to move').fill('1')
  await screenshot(page, 'bulk-move-desktop')
  await batchMove.getByRole('button', { name: 'Move all' }).click()
  await expect(page.locator('[data-status="todo"] button.card').filter({ hasText: 'bulk-move-a' })).toHaveCount(0)
  await expect(page.locator('[data-status="up_next"] button.card').filter({ hasText: 'bulk-move-a' })).toContainText('×2')
  await expect(page.locator('[data-status="up_next"] button.card').filter({ hasText: 'bulk-move-b' })).toContainText('×3')
  await expect(page.locator('[data-status="up_next"] button.card').filter({ hasText: 'bulk-move-single-c' })).toContainText('×1')

  await requestCard(page, 'bulk-move-single-c').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Download STL', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Move', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click()
  const cardMove = page.getByRole('dialog', { name: 'Move copies' })
  await choose(cardMove.getByLabel('Destination'), 'Printing')
  await cardMove.getByRole('button', { name: 'Move', exact: true }).click()
  await requestCard(page, 'bulk-move-single-c').click({ button: 'right' })
  await screenshot(page, 'card-context-menu')
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click()
  await choose(cardMove.getByLabel('Destination'), 'Queue')
  await cardMove.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(page.locator('[data-status="todo"] button.card').filter({ hasText: 'bulk-move-single-c' })).toBeVisible()

  await upload(page, { name: 'print-again', printType: 'Resin', buffer: boxStl('print-again', 10, 10, 10) })
  await dragCard(page, 'print-again', 'todo', 'in_progress')
  await requestCard(page, 'print-again').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Print again…' }).click()
  const repeatRequest = page.getByRole('dialog', { name: 'Print again' })
  await expect(repeatRequest.getByText('The existing request and its progress will not change.')).toBeVisible()
  await repeatRequest.getByLabel('Copies').fill('4')
  await screenshot(page, 'print-again-dialog')
  await repeatRequest.getByRole('button', { name: 'Create request' }).click()
  const repeatedPrint = page.locator('[data-status="todo"] button.card').filter({ hasText: 'print-again' })
  const originalPrint = page.locator('[data-status="in_progress"] button.card').filter({ hasText: 'print-again' })
  await expect(repeatedPrint).toContainText('×4')
  await expect(originalPrint).toContainText('×1')
  await expect.poll(() => repeatedPrint.locator('img').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)
  await repeatedPrint.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('alertdialog', { name: 'Delete 4 copies of “print-again”?' }).getByRole('button', { name: 'Delete copies' }).click()
  await expect(repeatedPrint).toHaveCount(0)
  await originalPrint.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('alertdialog', { name: 'Delete 1 copy of “print-again”?' }).getByRole('button', { name: 'Delete copy' }).click()
  await expect(originalPrint).toHaveCount(0)

  await upload(page, { name: 'split-delete', printType: 'Resin', buffer: boxStl('split-delete', 10, 10, 10), quantity: 2 })
  await upload(page, { name: 'stack-move', printType: 'Resin', buffer: boxStl('stack-move', 10, 10, 10), quantity: 2 })
  await dragCard(page, 'stack-move', 'todo', 'in_progress')
  await expect(page.getByRole('dialog', { name: 'Move copies' })).toHaveCount(0)
  await expect(page.locator('[data-status="todo"] button.card').filter({ hasText: 'stack-move' })).toHaveCount(0)
  await expect(page.locator('[data-status="in_progress"] button.card').filter({ hasText: 'stack-move' })).toContainText('×2')
  await screenshot(page, 'stack-move-all-copies')
  await dragCard(page, 'split-delete', 'todo', 'in_progress', true)
  const splitMove = page.getByRole('dialog', { name: 'Move copies' })
  await screenshot(page, 'stack-move-split-copies')
  await splitMove.getByLabel('Copies (of 2)').fill('1')
  await splitMove.getByRole('button', { name: 'Move', exact: true }).click()
  await page.locator('[data-status="in_progress"] button.card').filter({ hasText: 'split-delete' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const splitDelete = page.getByRole('alertdialog', { name: 'Delete 1 copy of “split-delete”?' })
  await splitDelete.getByRole('button', { name: 'Delete copy' }).click()
  await expect(page.locator('[data-status="todo"] button.card').filter({ hasText: 'split-delete' })).toContainText('×1')
  await expect(page.locator('[data-status="in_progress"] button.card').filter({ hasText: 'split-delete' })).toHaveCount(0, {
    timeout: 10_000,
  })

  await upload(page, { name: 'context-delete', printType: 'Resin', buffer: boxStl('context-delete', 10, 10, 10) })
  await requestCard(page, 'context-delete').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const contextDelete = page.getByRole('alertdialog', { name: 'Delete 1 copy of “context-delete”?' })
  let finishContextDelete!: () => void
  const contextDeleteFinished = new Promise<void>((resolve) => {
    finishContextDelete = resolve
  })
  let contextDeleteResumed!: () => void
  const contextDeleteResuming = new Promise<void>((resolve) => {
    contextDeleteResumed = resolve
  })
  await page.route('**/*', async (route) => {
    const isPost = route.request().method() === 'POST'
    if (isPost) await contextDeleteFinished
    await route.continue()
    if (isPost) contextDeleteResumed()
  })
  await contextDelete.getByRole('button', { name: 'Delete copy' }).click()
  await expect(contextDelete).toHaveCount(0)
  await expect(requestCard(page, 'context-delete')).toHaveCount(0)
  await screenshot(page, 'optimistic-context-delete')
  finishContextDelete()
  await contextDeleteResuming
  await page.unroute('**/*')

  await upload(page, { name: 'optimistic-delete', printType: 'Resin', buffer: boxStl('optimistic-delete', 10, 10, 10) })
  await requestCard(page, 'optimistic-delete').click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  let finishDelete!: () => void
  const deleteFinished = new Promise<void>((resolve) => {
    finishDelete = resolve
  })
  let deleteResumed!: () => void
  const deleteResuming = new Promise<void>((resolve) => {
    deleteResumed = resolve
  })
  await page.route('**/*', async (route) => {
    if (route.request().method() === 'POST') {
      await deleteFinished
      await route.continue()
      deleteResumed()
      return
    }
    await route.continue()
  })
  await page.getByRole('alertdialog', { name: 'Delete “optimistic-delete”?' }).getByRole('button', { name: 'Delete request' }).click()
  await expect(requestCard(page, 'optimistic-delete')).toHaveCount(0)
  await screenshot(page, 'optimistic-request-delete')
  finishDelete()
  await deleteResuming
  await page.unroute('**/*')

  await expect(page.getByRole('button', { name: 'New group' })).toHaveCount(0)
  await requestCard(page, 'bulk-move-single-a').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Add to group' })).toBeVisible()
  await screenshot(page, 'group-create-context-menu')
  await page.getByRole('menuitem', { name: 'Add to group' }).click()
  const defaultGroup = page.getByRole('region', { name: 'Group Group 1' })
  await expect(defaultGroup).toBeVisible()
  await screenshot(page, 'default-group-name')
  await defaultGroup.getByRole('heading', { name: 'Group 1' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const initialRename = page.getByRole('dialog', { name: 'Rename print group' })
  await initialRename.getByLabel('Group name').fill('Dragon plate')
  await initialRename.getByRole('button', { name: 'Rename group' }).click()
  const preparedGroup = page.getByRole('region', { name: 'Group Dragon plate' })
  await expect(preparedGroup).toContainText('1 print')
  await dragOnto(preparedGroup.locator('[data-group-drag-handle]'), page.locator('[data-status="up_next"] .column-body'))
  await expect(page.locator('[data-status="up_next"]').getByRole('region', { name: 'Group Dragon plate' })).toBeVisible()
  await requestCard(page, 'bulk-move-a').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Add to group' }).click()
  const upNextGroup = page.locator('[data-status="up_next"]').getByRole('region', { name: 'Group Group 2' })
  await expect(upNextGroup).toBeVisible()
  await expect(preparedGroup).toHaveAttribute('data-group-color', 'blue')
  await expect(upNextGroup).toHaveAttribute('data-group-color', 'green')
  await preparedGroup.getByRole('button', { name: 'Collapse Dragon plate' }).click()
  await expect(preparedGroup.getByRole('button', { name: /bulk-move-single-a/ })).toHaveCount(0)
  await page.reload()
  await expect(preparedGroup.getByRole('button', { name: 'Expand Dragon plate' })).toBeVisible()
  await expect(preparedGroup).toHaveAttribute('data-group-color', 'blue')
  await preparedGroup.getByRole('button', { name: 'Expand Dragon plate' }).click()
  await screenshot(page, 'group-created-outside-queue')
  await upNextGroup.getByRole('heading', { name: 'Group 2' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete group' }).click()
  await page.getByRole('alertdialog', { name: 'Delete “Group 2”?' }).getByRole('button', { name: 'Delete group' }).click()
  const groupHeader = preparedGroup.getByRole('heading', { name: 'Dragon plate' })
  await dragOnto(preparedGroup.getByRole('button', { name: /bulk-move-single-a/ }), page.locator('[data-status="todo"] .column-body'))
  await expect(preparedGroup).toContainText('0 prints')
  await expect(page.locator('[data-status="todo"] .card').filter({ hasText: 'bulk-move-single-a' })).toBeVisible()
  await requestCard(page, 'bulk-move-single-a').click({ modifiers: [multipleSelectionModifier] })
  await requestCard(page, 'bulk-move-single-b').click({ modifiers: [multipleSelectionModifier] })
  await dragOnto(requestCard(page, 'bulk-move-single-a'), groupHeader)
  await expect(preparedGroup).toContainText('2 prints')
  await screenshot(page, 'multi-selection-added-to-group')
  const groupedBulkMoveA = preparedGroup.getByRole('button', { name: /bulk-move-single-a/ })
  await groupedBulkMoveA.click({ modifiers: [multipleSelectionModifier] })
  await requestCard(page, 'first-model').click({ modifiers: [multipleSelectionModifier] })
  await expect(page.locator('button.card[aria-pressed="true"]')).toHaveCount(2)
  await groupedBulkMoveA.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Download STLs' })).toBeVisible()
  await screenshot(page, 'grouped-cross-column-selection')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await groupedBulkMoveA.click({ modifiers: [multipleSelectionModifier] })
  await requestCard(page, 'first-model').click({ modifiers: [multipleSelectionModifier] })
  await expect(page.locator('button.card[aria-pressed="true"]')).toHaveCount(2)
  await dragOnto(groupedBulkMoveA, page.locator('[data-status="in_progress"] .column-body'))
  const mixedGroupedMove = page.locator('[data-status="in_progress"] .card').filter({ hasText: 'bulk-move-single-a' })
  const mixedUngroupedMove = page.locator('[data-status="in_progress"] .card').filter({ hasText: 'first-model' })
  await expect(mixedGroupedMove).toBeVisible()
  await expect(mixedUngroupedMove).toBeVisible()
  await dragOnto(mixedUngroupedMove, page.locator('[data-status="todo"] .column-body'))
  await dragOnto(mixedGroupedMove, groupHeader)
  await dragOnto(preparedGroup.getByRole('button', { name: /bulk-move-single-a/ }), page.locator('[data-status="todo"] .column-body'))
  await expect(preparedGroup).toContainText('1 print')
  await dragOnto(preparedGroup.getByRole('button', { name: /bulk-move-single-b/ }), page.locator('[data-status="todo"] .column-body'))
  await expect(preparedGroup).toContainText('0 prints')
  await dragOnto(requestCard(page, 'bulk-move-a'), groupHeader, undefined, 0.5, true)
  const addCopies = page.getByRole('dialog', { name: 'Move copies' })
  await addCopies.getByLabel('Copies (of 2)').fill('1')
  await screenshot(page, 'group-copy-count-desktop')
  await addCopies.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(preparedGroup).toContainText('1 print')
  const remainingBulkMoveA = page.locator('[data-status="up_next"] .virtual-list .card').filter({ hasText: 'bulk-move-a' })
  await expect(remainingBulkMoveA).toContainText('×1')
  await dragOnto(remainingBulkMoveA, page.locator('[data-status="in_progress"] .column-body'))
  await expect(page.locator('[data-status="in_progress"] .card').filter({ hasText: 'bulk-move-a' })).toContainText('×1')
  await expect(preparedGroup).toContainText('1 print')
  await dragOnto(
    page.locator('[data-status="in_progress"] .card').filter({ hasText: 'bulk-move-a' }),
    page.locator('[data-status="up_next"] .column-body'),
    undefined,
    0.9,
  )
  await expect(remainingBulkMoveA).toContainText('×1')
  await dragOnto(remainingBulkMoveA, groupHeader)
  await expect(preparedGroup).toContainText('2 prints')
  await dragOnto(
    preparedGroup.getByRole('button', { name: /bulk-move-a/ }),
    page.locator('[data-status="todo"] .column-body'),
    undefined,
    0.5,
    true,
  )
  await screenshot(page, 'group-remove-copy-count')
  await addCopies.getByLabel('Copies (of 2)').fill('1')
  await addCopies.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(preparedGroup).toContainText('1 print')
  await expect(page.locator('[data-status="todo"] .card').filter({ hasText: 'bulk-move-a' })).toContainText('×1')
  await dragOnto(page.locator('[data-status="todo"] .card').filter({ hasText: 'bulk-move-a' }), groupHeader)
  await expect(addCopies).toHaveCount(0)
  await expect(preparedGroup).toContainText('2 prints')
  await screenshot(page, 'group-add-all-copies')
  await dragOnto(requestCard(page, 'bulk-move-b'), groupHeader)
  await expect(preparedGroup).toContainText('5 prints')
  await dragOnto(requestCard(page, 'bulk-move-single-c'), groupHeader)
  await expect(preparedGroup).toContainText('6 prints')
  const groupOrder = () =>
    preparedGroup.locator('button.card').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-request-name')))
  await expect.poll(groupOrder).toEqual(['bulk-move-a', 'bulk-move-b', 'bulk-move-single-c'])
  await dragOnto(
    preparedGroup.getByRole('button', { name: /bulk-move-b/ }),
    preparedGroup.getByRole('button', { name: /bulk-move-a/ }),
    undefined,
    0.1,
  )
  await expect.poll(groupOrder).toEqual(['bulk-move-b', 'bulk-move-a', 'bulk-move-single-c'])
  await dragOnto(preparedGroup.getByRole('button', { name: /bulk-move-single-c/ }), groupHeader)
  await expect(preparedGroup).toContainText('6 prints')
  await dragOnto(
    preparedGroup.getByRole('button', { name: /bulk-move-single-c/ }),
    page.locator('[data-status="in_progress"] .column-body'),
  )
  await expect(preparedGroup).toContainText('5 prints')
  await expect(page.locator('[data-status="in_progress"] .card').filter({ hasText: 'bulk-move-single-c' })).toBeVisible()
  await dragCard(page, 'bulk-move-single-c', 'in_progress', 'up_next')
  const movedBulkCard = page.locator('[data-status="up_next"] .card').filter({ hasText: 'bulk-move-single-c' })
  await expect(movedBulkCard).toBeVisible()
  await dragOnto(movedBulkCard, groupHeader)
  await expect(preparedGroup).toContainText('6 prints')
  await dragOnto(
    preparedGroup.getByRole('button', { name: /bulk-move-single-c/ }),
    page.locator('[data-status="up_next"] .column-body'),
    async () => await expect(page.locator('[data-status="up_next"] .column-body')).toHaveClass(/bg-blueprint/),
    0.9,
  )
  await expect(preparedGroup).toContainText('5 prints')
  await dragOnto(requestCard(page, 'bulk-move-single-c'), groupHeader)
  await expect(preparedGroup).toContainText('6 prints')
  await preparedGroup.getByRole('button', { name: /bulk-move-a/ }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Select' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Select' }).click()
  await preparedGroup.getByRole('button', { name: /bulk-move-b/ }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Add to selection' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Add to selection' }).click()
  await expect(preparedGroup.locator('button.card[aria-pressed="true"]')).toHaveCount(2)
  await preparedGroup.getByRole('button', { name: /bulk-move-a/ }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Download STLs' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Move', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible()
  await screenshot(page, 'group-multi-selection-actions')
  const groupedDownloadPromise = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Download STLs' }).click()
  expect((await groupedDownloadPromise).suggestedFilename()).toBe('stlquest-models.zip')
  await preparedGroup.getByRole('button', { name: /bulk-move-a/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  const groupedBatchDelete = page.getByRole('alertdialog', { name: 'Delete 2 selected cards?' })
  await expect(groupedBatchDelete).toContainText('This removes 5 instances from the board and cannot be undone.')
  await groupedBatchDelete.getByRole('button', { name: 'Cancel' }).click()
  await screenshot(page, 'group-multi-selection')
  await dragOnto(preparedGroup.getByRole('button', { name: /bulk-move-a/ }), page.locator('[data-status="in_progress"] .column-body'))
  const groupedBatchMove = page.getByRole('dialog', { name: 'Move 2 selected requests' })
  await groupedBatchMove.getByRole('button', { name: 'Move all' }).click()
  await expect(preparedGroup).toContainText('1 print')
  await expect(page.locator('[data-status="in_progress"] .card').filter({ hasText: 'bulk-move-a' })).toBeVisible()
  await expect(page.locator('[data-status="in_progress"] .card').filter({ hasText: 'bulk-move-b' })).toBeVisible()
  await dragOnto(page.locator('[data-status="in_progress"] .card').filter({ hasText: 'bulk-move-a' }), groupHeader)
  await dragOnto(page.locator('[data-status="in_progress"] .card').filter({ hasText: 'bulk-move-b' }), groupHeader)
  await expect(preparedGroup).toContainText('6 prints')
  await dragOnto(preparedGroup.locator('[data-group-drag-handle]'), page.locator('[data-status="in_progress"] .column-body'))
  await expect(page.locator('[data-status="in_progress"]').getByRole('region', { name: 'Group Dragon plate' })).toBeVisible()
  await screenshot(page, 'print-group-desktop')
  await preparedGroup.getByRole('heading', { name: 'Dragon plate' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const renameGroup = page.getByRole('dialog', { name: 'Rename print group' })
  await renameGroup.getByLabel('Group name').fill('Dragon production plate')
  await renameGroup.getByRole('button', { name: 'Rename group' }).click()
  const renamedGroup = page.getByRole('region', { name: 'Group Dragon production plate' })
  await expect(renamedGroup).toBeVisible()
  await renamedGroup.getByRole('heading', { name: 'Dragon production plate' }).click({ button: 'right' })
  await screenshot(page, 'group-context-menu')
  await page.getByRole('menuitem', { name: 'Delete group' }).click()
  const deleteGroup = page.getByRole('alertdialog', { name: 'Delete “Dragon production plate”?' })
  await expect(deleteGroup).toContainText('Only the group is removed. Every print in it stays on the board in this stage, ungrouped.')
  await deleteGroup.getByRole('button', { name: 'Delete group' }).click()
  await expect(renamedGroup).toHaveCount(0)
  await expect(page.locator('[data-status="in_progress"] .card').filter({ hasText: 'bulk-move-a' })).toBeVisible()

  await upload(page, { name: 'bulk-delete-a', printType: 'Resin', buffer: boxStl('bulk-delete-a', 10, 10, 10) })
  await upload(page, { name: 'bulk-delete-b', printType: 'Resin', buffer: boxStl('bulk-delete-b', 10, 10, 10), quantity: 2 })
  await dragCard(page, 'bulk-delete-b', 'todo', 'up_next', true)
  const splitBatchMove = page.getByRole('dialog', { name: 'Move copies' })
  await splitBatchMove.getByLabel('Copies (of 2)').fill('1')
  await splitBatchMove.getByRole('button', { name: 'Move', exact: true }).click()
  await requestCard(page, 'bulk-delete-a').click({ modifiers: [multipleSelectionModifier] })
  await page
    .locator('[data-status="todo"] button.card')
    .filter({ hasText: 'bulk-delete-b' })
    .click({ modifiers: [multipleSelectionModifier] })
  await page.locator('[data-status="todo"] button.card').filter({ hasText: 'bulk-delete-b' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const batchDelete = page.getByRole('alertdialog', { name: 'Delete 2 selected cards?' })
  await expect(batchDelete).toContainText('This removes 2 instances from the board and cannot be undone.')
  await expect(batchDelete.getByText('bulk-delete-a')).toBeVisible()
  await expect(batchDelete.getByText('bulk-delete-b')).toBeVisible()
  await expect(batchDelete.getByText('1 instance', { exact: true })).toHaveCount(2)
  await expect(batchDelete.locator('img[src*="/api/thumbs/"]')).toHaveCount(2)
  await batchDelete.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('2 selected', { exact: true })).toBeHidden()
  await page.locator('[data-status="todo"] button.card').filter({ hasText: 'bulk-delete-b' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await screenshot(page, 'bulk-delete-desktop')
  await batchDelete.getByRole('button', { name: 'Delete copies' }).click()
  await expect(requestCard(page, 'bulk-delete-a')).toHaveCount(0)
  await expect(page.locator('[data-status="todo"] button.card').filter({ hasText: 'bulk-delete-b' })).toHaveCount(0)
  await expect(page.locator('[data-status="up_next"] button.card').filter({ hasText: 'bulk-delete-b' })).toContainText('×1')

  await page.setViewportSize({ width: 390, height: 720 })
  await longPress(requestCard(page, 'first-model'))
  await expect(page.getByRole('menuitem', { name: 'Select' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Select' }).click()
  await requestCard(page, 'large-order').click()
  await expect(page.locator('button.card[aria-pressed="true"]')).toHaveCount(2)
  await longPress(requestCard(page, 'first-model'))
  await expect(page.getByRole('menuitem', { name: 'Remove from selection' })).toBeVisible()
  await screenshot(page, 'bulk-selection-mobile')
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click()
  const mobileMove = page.getByRole('dialog', { name: 'Move 2 selected requests' })
  const mobileMoveBox = await mobileMove.boundingBox()
  expect(mobileMoveBox?.y).toBeLessThanOrEqual(20)
  expect(mobileMoveBox?.height).toBeGreaterThan(650)
  await screenshot(page, 'bulk-move-mobile')
  await mobileMove.getByRole('button', { name: 'Cancel' }).click()
  await longPress(requestCard(page, 'first-model'))
  await page.getByRole('menuitem', { name: 'Remove from selection' }).click()
  await longPress(requestCard(page, 'large-order'))
  await page.getByRole('menuitem', { name: 'Remove from selection' }).click()
  await longPress(requestCard(page, 'bulk-move-single-a'))
  await page.getByRole('menuitem', { name: 'Select' }).click()
  await longPress(requestCard(page, 'bulk-move-single-a'))
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Move 1 selected request' })).toBeVisible()
  await screenshot(page, 'bulk-move-single-destination-mobile')
  await page.getByRole('dialog', { name: 'Move 1 selected request' }).getByRole('button', { name: 'Cancel' }).click()
  await longPress(requestCard(page, 'bulk-move-single-a'))
  await page.getByRole('menuitem', { name: 'Remove from selection' }).click()
  await page.locator('[data-status="todo"]').getByRole('button', { name: 'Select' }).click()
  await requestCard(page, 'first-model').click()
  await page.locator('[data-status="todo"][data-slot="column-header"]').first().click()
  await expect(page.locator('button.card[aria-pressed="true"]')).toHaveCount(0)

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
  await dragCard(page, 'large-order', 'todo', 'up_next', true)
  await page.getByRole('dialog', { name: 'Move copies' }).getByLabel('Copies (of 3)').fill('1')
  await page.getByRole('dialog', { name: 'Move copies' }).getByRole('button', { name: 'Move', exact: true }).click()
  await dragCard(page, 'large-order', 'todo', 'in_progress', true)
  await page.getByRole('dialog', { name: 'Move copies' }).getByLabel('Copies (of 2)').fill('1')
  await page.getByRole('dialog', { name: 'Move copies' }).getByRole('button', { name: 'Move', exact: true }).click()
  await dragCardOntoCard(page, 'large-order', 'todo', 'up_next')
  await expect(page.locator('[data-status="todo"] button.card').filter({ hasText: 'large-order' })).toHaveCount(0)
  await expect(page.locator('[data-status="up_next"] button.card').filter({ hasText: 'large-order' })).toContainText('×2 of 3')
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

  await assignedCard.click()
  const requestEditor = page.getByRole('dialog', { name: 'first-model' })
  const downloadStl = requestEditor.getByRole('link', { name: 'Download STL' })
  await downloadStl.scrollIntoViewIfNeeded()
  await expect(downloadStl).toBeVisible()
  await expect(requestEditor.getByRole('button', { name: 'Move copies…' })).toBeVisible()
  await screenshot(page, 'build-plate-prep-action')
  await requestEditor.getByRole('button', { name: 'Move copies…' }).click()
  const prepMove = page.getByRole('dialog', { name: 'Move copies' })
  await expect(prepMove.getByLabel('Destination')).toContainText('Up next')
  await prepMove.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(prepMove).toBeHidden()
  await expect(requestEditor.getByRole('button', { name: 'Move copies…' })).toHaveCount(0)
  await requestEditor.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('[data-status="up_next"] button.card').filter({ hasText: 'first-model' })).toBeVisible()
  await dragCard(page, 'first-model', 'up_next', 'todo')

  // Regression: a stalled model fetch must surface an error with a retry instead of
  // sitting on "loading model…" forever and leaving the modal dead to clicks.
  await page.route('**/api/files/**', () => {}) // never fulfils — simulates a hung asset-store read
  await requestCard(page, 'first-model').click()
  await expect(page.getByText('loading model…')).toBeVisible()
  // The modal's controls stay usable while the model load is in flight.
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  await expect(page.getByText("couldn't load this model")).toBeVisible({ timeout: 30_000 })
  const retryModel = page.getByRole('button', { name: 'retry' })
  await expect(retryModel).toBeVisible()
  await screenshot(page, 'stl-viewer-load-error')
  // Retrying re-initiates the load — still stalled here, so it returns to the loading state.
  await retryModel.click()
  await expect(page.getByText('loading model…')).toBeVisible()
  await page.unroute('**/api/files/**')
  // The modal still responds to input despite the failed load.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)

  await upload(page, { name: 'oversized-model', printType: 'Resin', buffer: boxStl('oversized-model', 150, 150, 100) })
  await expect(requestCard(page, 'oversized-model').getByLabel('Fits no printer')).toBeVisible({ timeout: 30_000 })
  await screenshot(page, 'oversized-model-alert')

  await page.route('**/api/upload', async (route) => {
    await route.fulfill({
      status: 423,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'storage migration is in progress — uploads are temporarily paused' }),
    })
  })
  await page.getByRole('button', { name: 'Add a print' }).click()
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'paused-upload.stl', mimeType: 'model/stl', buffer: boxStl('paused-upload', 10, 10, 10) })
  await page.getByRole('button', { name: 'Add 1 print' }).click()
  await expect(page.getByText('Uploads are paused while storage is moving. Wait for the migration to finish.')).toBeVisible({
    timeout: 15_000,
  })
  await screenshot(page, 'upload-paused-during-migration')
  await page.unroute('**/api/upload')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('alertdialog', { name: 'Discard upload?' }).getByRole('button', { name: 'Discard' }).click()

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
  await expect
    .poll(() =>
      page
        .getByRole('row', { name: 'Printer 1' })
        .locator('img')
        .evaluate((image) => image.naturalWidth),
    )
    .toBeGreaterThan(0)
  await expect(page.getByLabel(/Usable width|Planning and material assumptions/)).toHaveCount(0)
  await screenshot(page, 'printer-assignment-settings')

  await page.getByRole('link', { name: 'Storage' }).click()
  await page.getByRole('button', { name: 'Edit current storage' }).click()
  const populatedStorageRoot = page.getByLabel('Folder')
  const originalStorageRoot = await populatedStorageRoot.inputValue()
  await populatedStorageRoot.fill(`${originalStorageRoot}-migrated`)
  await page.getByRole('button', { name: 'Save storage' }).click()
  const migrationReview = page.getByRole('alertdialog', { name: 'Move your files to the new location?' })
  await expect(migrationReview.getByText(originalStorageRoot, { exact: true })).toBeVisible()
  await migrationReview.getByRole('button', { name: 'Copy files and switch' }).click()
  await expect(page.getByText(/Starting migration…|Migrating storage|Migration completed/).first()).toBeVisible()
  await screenshot(page, 'storage-migration-starting')
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Leave without saving?' })).toHaveCount(0)
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('link', { name: 'Storage' }).click()
  await expect(
    page.getByText(/The original storage remains active until verification completes.|Migration completed/).first(),
  ).toBeVisible()
  await expect(page.getByText('Migration completed', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(populatedStorageRoot).toHaveValue(`${originalStorageRoot}-migrated`)
  await populatedStorageRoot.fill(originalStorageRoot)
  await page.getByRole('button', { name: 'Save storage' }).click()
  const populatedDestinationReview = page.getByRole('alertdialog', { name: 'That folder is not empty' })
  await expect(populatedDestinationReview.getByText(/\d+ files? and \d+ folders? \(/).first()).toBeVisible()
  await populatedDestinationReview.getByText('See what is already there').click()
  await expect(populatedDestinationReview.locator('li').first()).toBeVisible()
  await screenshot(page, 'storage-destination-contents')
  const deleteFirst = populatedDestinationReview.getByRole('button', { name: /Delete everything there first/ })
  await deleteFirst.click()
  await expect(deleteFirst).toHaveAttribute('aria-pressed', 'true')
  // The destructive path stays disabled until the consequence is acknowledged, without a second stacked dialog.
  const switchAndDelete = populatedDestinationReview.getByRole('button', { name: 'Delete and switch' })
  await expect(switchAndDelete).toBeDisabled()
  await screenshot(page, 'storage-destination-delete-choice')
  await populatedDestinationReview.getByText('deleted for good').click()
  await switchAndDelete.click()
  await expect(populatedDestinationReview).toHaveCount(0)
  await expect(page.getByText('Migrating storage')).toBeVisible()
  await expect(page.getByText('Migration completed', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(populatedStorageRoot).toHaveValue(originalStorageRoot)

  // A migration whose destination is gone for good must still leave a way to choose another one:
  // the retry button alone is a dead end. Removing a model the requests still reference fails the
  // copy deterministically, because the source is enumerated from the database.
  const strandedModel = await findStoredModel(originalStorageRoot)
  const strandedBytes = await fs.readFile(strandedModel)
  await fs.rm(strandedModel)
  await populatedStorageRoot.fill(`${originalStorageRoot}-stranded`)
  await page.getByRole('button', { name: 'Save storage' }).click()
  const strandedReview = page.getByRole('alertdialog', { name: 'Move your files to the new location?' })
  await strandedReview.getByRole('button', { name: 'Copy files and switch' }).click()
  await expect(page.getByText('Migration failed', { exact: true })).toBeVisible({ timeout: 30_000 })
  // Reopening the page is the dead end: no provider is half-chosen any more, so the failed
  // migration is all that decides what renders.
  await page.reload()
  await expect(page.getByText('Migration failed', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry migration' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Change where your models live' })).toBeVisible()
  await expect(page.getByRole('button', { name: /A folder on this server/ })).toBeVisible()
  await screenshot(page, 'storage-migration-failed-options')
  await page.getByRole('button', { name: 'Edit current storage' }).click()
  await fs.writeFile(strandedModel, strandedBytes)
  await page.getByRole('button', { name: 'Retry migration' }).click()
  await expect(page.getByText('Migration completed', { exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Edit current storage' }).click()
  await expect(page.getByLabel('Folder')).toHaveValue(`${originalStorageRoot}-stranded`)
  await page.getByLabel('Folder').fill(originalStorageRoot)
  await page.getByRole('button', { name: 'Save storage' }).click()
  const strandedRestore = page.getByRole('alertdialog', { name: /Move your files to the new location\?|That folder is not empty/ })
  await strandedRestore
    .getByRole('button', { name: /Copy files and switch|Delete and switch/ })
    .first()
    .click()
  await expect(page.getByText('Migration completed', { exact: true })).toBeVisible({ timeout: 30_000 })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Choose where your models live' })).toHaveCount(0)
  await expect(page.locator('[data-status="todo"]').first()).toBeVisible()

  await page.goto('/about')
  await expect(page.getByText('STL Quest is open source under the GNU Affero General Public License v3.0.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Source code' })).toHaveAttribute(
    'href',
    'https://github.com/richardsolomou/stl.quest/tree/main',
  )
  await screenshot(page, 'about-agpl-source')

  await page.goto('/admin/integrations')
  await page.setViewportSize({ width: 1280, height: 1000 })
  await expect(page.getByText('Workspace membership is always invite-only.')).toBeVisible()
  await expect(page.getByText('Joining an existing workspace always requires an invite.')).toBeVisible()
  await screenshot(page, 'integration-storage-providers')
  await expect(page.getByText('Local folders')).toHaveCount(0)
  const dropboxIntegration = page.getByRole('region', { name: 'Dropbox' })
  await dropboxIntegration.getByRole('button', { name: 'Set up app' }).click()
  const dropboxDialog = page.getByRole('dialog', { name: 'Set up the Dropbox app' })
  await dropboxDialog.getByLabel('App key').fill('test-app-key')
  await dropboxDialog.getByLabel('App secret').fill('test-app-secret')
  await dropboxDialog.getByRole('button', { name: 'Save' }).click()
  await expect(dropboxIntegration.getByText('Available to workspaces')).toBeVisible()
  await dropboxIntegration.getByRole('switch', { name: 'Disable Dropbox' }).click()
  await expect(dropboxIntegration.getByText('Disabled', { exact: true })).toBeVisible()
  await screenshot(page, 'integration-cloud-provider-disabled')
  await dropboxIntegration.getByRole('switch', { name: 'Enable Dropbox' }).click()
  await expect(dropboxIntegration.getByText('Available to workspaces')).toBeVisible()
  await screenshot(page, 'integration-account-access-copy')
  await page
    .locator('[data-slot="settings-section"]')
    .filter({ hasText: 'Outbound email' })
    .getByRole('button', { name: 'Set up SMTP' })
    .click()
  await expect(page.getByLabel('Security')).toContainText('STARTTLS')
  await expectDialogButtonClickSurvivesScrollbar(page)
  await screenshot(page, 'smtp-security-label')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.goto('/')
  const queueCleanupNames = ['oversized-model', 'split-delete', 'bulk-move-single-b', 'bulk-move-single-a', 'first-model']
  await requestCard(page, queueCleanupNames[0]).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Select' }).click()
  for (const name of queueCleanupNames.slice(1)) {
    await requestCard(page, name).click({ modifiers: [multipleSelectionModifier] })
  }
  const selectedQueueCards = page.locator('[data-status="todo"] button.card[aria-pressed="true"]')
  await expect(selectedQueueCards).not.toHaveCount(0)
  await selectedQueueCards.first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const queueCleanup = page.getByRole('alertdialog', { name: /Delete \d+ selected cards\?/ })
  await queueCleanup.getByRole('button', { name: 'Delete copies' }).click()
  await expect(page.locator('[data-status="todo"] button.card')).toHaveCount(0)

  // No workspace here uses included storage, so there is no allowance to report.
  await expect(page.getByRole('button', { name: /storage available/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Open account menu' }).click()
  await expect(page.getByRole('link', { name: /^Admin/ })).toBeVisible()
  await screenshot(page, 'account-menu-super-admin')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  const createWorkspace = page.getByRole('dialog', { name: 'Create workspace' })
  // Plan allowances are a hosted concept, so a self-hosted install must not mention them.
  await expect(createWorkspace.getByText('plan allowance')).toHaveCount(0)
  await createWorkspace.getByLabel('Workspace name').fill('Second workshop')
  await createWorkspace.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Choose where your models live' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use this folder' })).toBeVisible()
  await expect(page.getByText('Setting up Second workshop')).toBeVisible()
  await expect(page.getByText('Step 1 of 2')).toBeVisible()
  await screenshot(page, 'workspace-storage-setup')

  await page.getByRole('button', { name: 'Open account menu' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

  await page.goto('/?signup=true')
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible()
  await screenshot(page, 'create-account-link')
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
  expect((await request.get('/api/files/batch?id=first&id=second')).status()).toBe(401)
  expect((await request.get('/api/events')).status()).toBe(401)
  expect((await request.get('/api/board-presence')).status()).toBe(401)
})

test('serves every stylesheet referenced by the rendered document', async ({ request }) => {
  const root = await request.get('/')
  const stylesheets = [...(await root.text()).matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((match) => match[1])
  const responses = await Promise.all(stylesheets.map((stylesheet) => request.get(stylesheet)))

  expect(responses.map((response) => response.status())).toEqual(stylesheets.map(() => 200))
})

test('super admin routes redirect unauthenticated users', async ({ page }) => {
  await page.goto('/admin/integrations')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('button', { name: /^(Set up STL Quest|Sign in)$/ })).toBeVisible()
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

async function dragCard(page: Page, name: string, from: string, to: string, split = false) {
  const card = page.locator(`[data-status="${from}"] .card`).filter({ hasText: name })
  const target = page.locator(`[data-status="${to}"] .column-body`)
  const [cardBox, targetBox] = await Promise.all([card.boundingBox(), target.boundingBox()])
  expect(cardBox).not.toBeNull()
  expect(targetBox).not.toBeNull()
  if (split) await page.keyboard.down('Alt')
  await page.mouse.move(cardBox!.x + 32, cardBox!.y + 32)
  await page.mouse.down()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 40, { steps: 12 })
  await page.mouse.up()
  if (split) await page.keyboard.up('Alt')
}

async function dragCardOntoCard(page: Page, name: string, from: string, to: string) {
  const card = page.locator(`[data-status="${from}"] .card`).filter({ hasText: name })
  const target = page.locator(`[data-status="${to}"] .card`).filter({ hasText: name })
  const [cardBox, targetBox] = await Promise.all([card.boundingBox(), target.boundingBox()])
  expect(cardBox).not.toBeNull()
  expect(targetBox).not.toBeNull()
  await page.mouse.move(cardBox!.x + 32, cardBox!.y + 32)
  await page.mouse.down()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 })
  await page.mouse.up()
}

async function dragOnto(source: Locator, target: Locator, duringDrag?: () => Promise<void>, targetY = 0.5, split = false) {
  await expect(source).toBeVisible()
  await expect(target).toBeVisible()
  let sourceBox = await source.boundingBox()
  let targetBox = await target.boundingBox()
  await expect
    .poll(async () => {
      const boxes = await Promise.all([source.boundingBox(), target.boundingBox()])
      sourceBox = boxes[0]
      targetBox = boxes[1]
      return Boolean(sourceBox && targetBox)
    })
    .toBe(true)
  expect(sourceBox).not.toBeNull()
  expect(targetBox).not.toBeNull()
  if (split) await source.page().keyboard.down('Alt')
  await source.page().mouse.move(sourceBox!.x + 32, sourceBox!.y + 32)
  await source.page().mouse.down()
  await source.page().mouse.move(sourceBox!.x + 40, sourceBox!.y + 40, { steps: 2 })
  await duringDrag?.()
  await source.page().mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height * targetY, { steps: 12 })
  await source.page().mouse.up()
  if (split) await source.page().keyboard.up('Alt')
}

async function longPress(card: Locator) {
  const box = await card.boundingBox()
  expect(box).not.toBeNull()
  const point = { clientX: box!.x + 20, clientY: box!.y + 20, pointerType: 'touch', pointerId: 1, isPrimary: true }
  await card.dispatchEvent('pointerdown', point)
  await card.page().waitForTimeout(550)
  await card.dispatchEvent('contextmenu', point)
  await card.dispatchEvent('pointerup', point)
}

async function screenshot(page: Page, name: string) {
  if (!captureScreenshots) return
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true })
}

// Local storage namespaces each workspace below the configured root, so walk to the first model
// rather than assuming the workspace id or the stored file name.
async function findStoredModel(storageRoot: string): Promise<string> {
  for (const entry of await fs.readdir(storageRoot, { withFileTypes: true })) {
    const candidate = path.join(storageRoot, entry.name)
    if (entry.isDirectory()) {
      const found = await findStoredModel(candidate).catch(() => undefined)
      if (found) return found
    } else if (entry.name.endsWith('.stl')) return candidate
  }
  throw new Error(`no stored model found under ${storageRoot}`)
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
