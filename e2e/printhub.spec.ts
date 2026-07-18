import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { boxStl } from './fixtures/stl'

const email = 'owner@example.com'
const password = 'correct-horse-battery-staple'
const screenshots = path.join(process.cwd(), 'test-results/manual-inspection')
const captureScreenshots = process.env.CAPTURE_E2E_SCREENSHOTS === '1' || process.env.CAPTURE_SCREENSHOTS === '1'

test.beforeAll(async () => {
  if (captureScreenshots) await fs.mkdir(screenshots, { recursive: true })
})

test('complete resin, filament, fleet-adaptive, settings, and invite journey', async ({ page, browser }) => {
  test.setTimeout(300_000)
  await optimizePageForE2E(page)
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
  const localRoot = await page.getByLabel('Folder').inputValue()
  await page.getByRole('combobox', { name: 'Adapter' }).click()
  await page.getByRole('option', { name: 'S3-compatible object storage' }).click()
  await expect(page.getByRole('combobox', { name: 'Provider' })).toContainText('Backblaze B2')
  await expect(page.getByLabel('Region')).toHaveValue('us-west-004')
  await page.getByRole('combobox', { name: 'Adapter' }).click()
  await page.getByRole('option', { name: 'Cloud storage' }).click()
  await expect(page.getByRole('combobox', { name: 'Cloud provider' })).toContainText('Google Drive')
  await page.getByRole('combobox', { name: 'Adapter' }).click()
  await page.getByRole('option', { name: 'Local folder' }).click()
  await expect(page.getByLabel('Folder')).toHaveValue(localRoot)
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
  await expect(page.getByLabel('Refreshing board')).toHaveCount(0)

  const accountMenu = page.getByRole('button', { name: 'Open account menu' })
  await expect(accountMenu).toHaveCSS('cursor', 'pointer')
  await accountMenu.hover()
  await expect(accountMenu).toHaveCSS('transform', 'none')
  await accountMenu.click()
  await expect(accountMenu).toHaveCSS('transform', 'none')
  await expect(page.getByText('Workspaces', { exact: true })).toBeVisible()
  const activeWorkspaceButton = page.locator('button[aria-current="true"]')
  const createWorkspaceButton = page.getByRole('button', { name: 'Create workspace' })
  await expect
    .poll(async () => {
      const [activeBox, createBox] = await Promise.all([activeWorkspaceButton.boundingBox(), createWorkspaceButton.boundingBox()])
      return activeBox && createBox ? Math.round(activeBox.width - createBox.width) : undefined
    })
    .toBe(0)
  await mobileScreenshot(page, 'account-menu-mobile')
  await screenshot(page, 'account-menu-desktop')
  const originalWorkspace = (await activeWorkspaceButton.innerText()).trim()
  await createWorkspaceButton.click()
  await page.getByPlaceholder('Workspace name').fill('Second farm')
  const createReload = page.waitForEvent('load')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await createReload
  await expect(page.getByRole('heading', { name: 'Add your printers' })).toBeVisible()
  await page.getByRole('button', { name: 'Open account menu' }).click()
  await expect(page.getByRole('button', { name: 'Second farm', exact: true })).toHaveAttribute('aria-current', 'true')
  const switchReload = page.waitForEvent('load')
  await page.getByRole('button', { name: originalWorkspace, exact: true }).click()
  await switchReload
  await expect(page.getByRole('button', { name: 'Add a print' })).toBeVisible()
  await page.getByRole('button', { name: 'Open account menu' }).click()
  const deleteWorkspaceReload = page.waitForEvent('load')
  await page.getByRole('button', { name: 'Second farm', exact: true }).click()
  await deleteWorkspaceReload
  await expect(page.getByRole('heading', { name: 'Add your printers' })).toBeVisible()
  await page.goto('/settings/board')
  await expect(page.getByRole('heading', { name: 'Danger zone' })).toBeVisible()
  await page.getByRole('button', { name: 'Delete workspace' }).click()
  const deleteDialog = page.getByRole('alertdialog')
  await expect(deleteDialog.getByRole('heading', { name: 'Delete Second farm?' })).toBeVisible()
  await deleteDialog.getByLabel('Workspace name').fill('Second farm')
  await mobileScreenshot(page, 'delete-workspace-confirmation-mobile')
  await screenshot(page, 'delete-workspace-confirmation-desktop')
  const deletedWorkspaceReload = page.waitForEvent('load')
  await deleteDialog.getByRole('button', { name: 'Delete workspace' }).click()
  await deletedWorkspaceReload
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible()
  await expect(page.getByText(originalWorkspace, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open account menu' }).click()
  await expect(page.getByRole('button', { name: 'Second farm', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Delete workspace' })).toBeDisabled()
  await expect(page.getByText('Create another workspace before deleting this one.')).toBeVisible()
  const planningStrategy = page.getByLabel('Plate planning strategy')
  await expect(planningStrategy).toContainText('Balanced')
  await choose(planningStrategy, 'User priority')
  await expect(page.getByText('Board settings saved.')).toBeVisible()
  await expect(
    page.getByText("Fill plates efficiently while working through every requester's personal queue as fairly as possible."),
  ).toBeVisible()
  await choose(planningStrategy, 'Tallest first')
  await expect(
    page.getByText('Fill plates efficiently while starting with the tallest models and compatible resin height bands.'),
  ).toBeVisible()
  await screenshot(page, 'workspace-settings-tallest-strategy-desktop')
  await choose(planningStrategy, 'Balanced')
  await expect(
    page.getByText('Weight plate fill (40%), requester priority (35%), and resin height compatibility (25% when applicable).'),
  ).toBeVisible()
  await mobileScreenshot(page, 'workspace-settings-mobile')
  await screenshot(page, 'workspace-settings-desktop')
  await expect(page.getByRole('link', { name: 'Diagnostics', exact: true })).toHaveCount(0)
  await mainNav(page, 'Board').click()
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
  await page.setViewportSize({ width: 320, height: 844 })
  const stlCanvas = page.locator('.viewer canvas')
  await expect(stlCanvas).toBeVisible({ timeout: 30_000 })
  await expect(stlCanvas).toHaveCSS('pointer-events', 'auto')
  await expect(stlCanvas).toHaveCSS('touch-action', 'none')
  await page.waitForTimeout(200)
  const beforeDrag = await stlCanvas.screenshot()
  const canvasBox = await stlCanvas.boundingBox()
  expect(canvasBox).not.toBeNull()
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.35, canvasBox!.y + canvasBox!.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.65, canvasBox!.y + canvasBox!.height * 0.5, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => beforeDrag.equals(await stlCanvas.screenshot())).toBe(false)
  await page.setViewportSize({ width: 1280, height: 800 })
  await mobileScreenshot(page, 'single-resin-request-mobile')
  await page.getByRole('button', { name: 'Close' }).click()
  await page
    .getByRole('region', { name: 'Board filters' })
    .getByRole('button', { name: /^Filters/ })
    .click()
  await expect(page.getByLabel('Filter by print type')).toBeVisible()
  await expect(page.getByLabel('Filter by assigned printer')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close filters' }).click()

  await upload(page, {
    name: 'resin-companion',
    printType: 'Resin',
    buffer: boxStl('resin-companion', 8, 8, 8),
  })

  const resinCubeSelection = page.getByRole('checkbox', { name: 'Add resin-cube to planning selection', exact: true })
  const resinCompanionSelection = page.getByRole('checkbox', { name: 'Add resin-companion to planning selection', exact: true })
  await requestCard(page, 'resin-cube').hover()
  await resinCubeSelection.click()
  await requestCard(page, 'resin-companion').hover()
  await resinCompanionSelection.click()
  await expect(page.getByLabel('Bulk actions')).toContainText('2 selected')
  await page.setViewportSize({ width: 320, height: 844 })
  await expect(page.locator('[data-selection-checkbox]:visible')).toHaveCount(0)
  await expect(page.getByLabel('Bulk actions')).toContainText('2 selected')
  await screenshot(page, 'plan-next-board-mobile')
  await page.setViewportSize({ width: 1280, height: 800 })
  await screenshot(page, 'plan-next-board-desktop')
  await page.getByRole('button', { name: 'Actions' }).click()
  await expect(page.getByRole('button', { name: 'Delete requests' })).toBeVisible()
  await screenshot(page, 'bulk-actions-menu-desktop')
  const [boardPadding, filterPadding] = await Promise.all([
    page.locator('main.board').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft)),
    page.getByRole('region', { name: 'Board filters' }).evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft)),
  ])
  expect(filterPadding).toBe(boardPadding)
  await page.getByRole('button', { name: 'Plan next' }).click()
  expect(new URL(page.url()).searchParams.has('next')).toBe(true)
  expect(page.url()).not.toContain('%')
  expect([...new URL(page.url()).searchParams.keys()]).toEqual(['next'])
  await expect(page.getByText('Layouts use resin orientation analysis')).toBeVisible()
  const plannerStrategy = page.getByLabel('Planning strategy')
  await expect(plannerStrategy).toContainText('Balanced')
  await choose(plannerStrategy, 'Oldest first')
  await expect(page.getByText('Fill plates efficiently while processing the longest-waiting requests first.')).toBeVisible()
  await choose(plannerStrategy, 'Balanced')
  const exportMenu = page.getByRole('button', { name: 'Export', exact: true })
  await expect(exportMenu).toBeVisible({ timeout: 30_000 })
  await expect(exportMenu.locator('img')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'resin-cube' })).toBeVisible()
  await expect(page.getByText('Manually planned next')).toHaveCount(2)
  await verifyPlannerFillsViewport(page, boardPadding)
  await screenshot(page, 'plan-next-planner-desktop')
  await mobileScreenshot(page, 'plan-next-planner-mobile')
  await exportMenu.click()
  const dragonFruitOption = page.getByRole('button', { name: /DragonFruit.*\.voxl/ })
  await expect(dragonFruitOption).toBeVisible()
  await expect.poll(() => dragonFruitOption.locator('img').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: /3MF.*\.3mf/ })).toBeVisible()
  await screenshot(page, 'export-format-menu-desktop')
  await mobileScreenshot(page, 'export-format-menu-mobile')
  await exportMenu.click()
  await verifyVoxlMenuDownload(page, 'resin-station-plate-1.voxl')
  await verify3mfMenuDownload(page, 'resin-station-plate-1.3mf')
  await expect(page.getByText('Manually planned next')).toHaveCount(2)

  await mainNav(page, 'Board').click()
  await requestCard(page, 'resin-companion').hover()
  await page.getByRole('checkbox', { name: 'Add resin-companion to planning selection', exact: true }).click()
  await page.getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('button', { name: 'Delete request', exact: true }).click()
  await page.getByRole('button', { name: 'Delete request', exact: true }).click()
  await expect(requestCard(page, 'resin-companion')).toHaveCount(0)
  await requestCard(page, 'resin-cube').click()
  await expect(page.getByText(/≈1 ml each/)).toBeVisible()
  await expect(page.getByText(/solid model volume/i)).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await moveCard(page, 'resin-cube', 'todo', 'in_progress')
  await moveCard(page, 'resin-cube', 'in_progress', 'post_processing')
  await moveCard(page, 'resin-cube', 'post_processing', 'done')
  await expect(page.locator('[data-status="done"]')).toContainText('resin-cube')

  await mainNav(page, 'Account settings').click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('heading', { name: 'Sign-in methods' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Account settings sections' })).toHaveCount(0)
  await expect(page.locator('.sign-out')).toHaveCount(0)
  await mobileScreenshot(page, 'account-settings-mobile')
  await screenshot(page, 'account-settings-desktop')
  await mainNav(page, 'About').click()
  await expect(page).toHaveURL(/\/about$/)
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await mobileScreenshot(page, 'about-mobile')
  await screenshot(page, 'about-desktop')
  await mainNav(page, 'Account settings').click()
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await mainNav(page, 'Admin').click()
  await expect(page).toHaveURL(/\/admin\/users$/)
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  await expect(page.getByRole('cell', { name: email, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add user' }).click()
  await expect(page.getByRole('heading', { name: 'Create user' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('link', { name: 'Integrations' }).click()
  await expect(page).toHaveURL(/\/admin\/integrations$/)
  const googleAuthentication = page.getByRole('region', { name: 'Google authentication' })
  await googleAuthentication.getByRole('button', { name: 'Configure' }).click()
  await expect(page.getByRole('heading', { name: 'Configure Google' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Google Auth Platform' })).toHaveAttribute(
    'href',
    'https://console.cloud.google.com/auth/clients',
  )
  await expect(page.getByText(`${new URL(page.url()).origin}/api/auth/callback/google`, { exact: true })).toBeVisible()
  await screenshot(page, 'google-auth-setup-desktop')
  await mobileScreenshot(page, 'google-auth-setup-mobile')
  await page.getByRole('button', { name: 'Cancel' }).click()
  const discordAuthentication = page.getByRole('region', { name: 'Discord authentication' })
  await discordAuthentication.getByRole('button', { name: 'Configure' }).click()
  await expect(page.getByRole('heading', { name: 'Configure Discord' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Discord Developer Portal' })).toHaveAttribute(
    'href',
    'https://discord.com/developers/applications',
  )
  await expect(page.getByText(`${new URL(page.url()).origin}/api/auth/callback/discord`, { exact: true })).toBeVisible()
  await screenshot(page, 'discord-auth-setup-desktop')
  await mobileScreenshot(page, 'discord-auth-setup-mobile')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('link', { name: 'Diagnostics' }).click()
  await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'System health' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Storage and processing' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh diagnostics' })).toHaveCount(0)
  await mobileScreenshot(page, 'admin-diagnostics-mobile')
  await screenshot(page, 'admin-diagnostics-desktop')
  await workspaceSettings(page)
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
  const resinAssumptions = page.getByRole('region', { name: 'Printer 1' }).locator('details')
  await resinAssumptions.getByLabel('Planning and material assumptions').click()
  await page.setViewportSize({ width: 1365, height: 768 })
  await expect.poll(() => resinAssumptions.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  if (captureScreenshots) {
    await resinAssumptions.screenshot({ path: path.join(screenshots, 'resin-assumptions-responsive.png') })
  }
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

  await workspaceSettings(page)
  await page.getByRole('link', { name: 'Printers' }).click()
  const filamentEnabled = page.getByRole('region', { name: 'Printer 2' }).getByRole('switch', { name: 'Enabled' })
  await filamentEnabled.click()
  await expect(filamentEnabled).not.toBeChecked()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Printers updated.').last()).toBeVisible()

  await mainNav(page, 'Board').click()
  await requestCard(page, 'filament-block').click()
  await expect(page.getByRole('combobox', { name: 'Print type', exact: true })).toContainText('Filament')
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Add a print' }).click()
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'new-target.stl', mimeType: 'model/stl', buffer: boxStl('new-target', 10, 10, 10) })
  const printType = page.getByLabel('Print type for new target')
  await expect(printType).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Discard' }).click()

  await mainNav(page, 'Planner').click()
  await expect(page.getByRole('heading', { name: 'Printer' })).toBeVisible()
  await page.getByLabel('Printer', { exact: true }).click()
  await expect(page.getByRole('option', { name: /Workshop Filament/ })).toHaveCount(0)
  await page.getByRole('option', { name: /Resin Station/ }).click()
  await expect(page.locator('[data-slot="select-content"]')).not.toBeVisible()

  await workspaceSettings(page)
  await page.getByRole('link', { name: 'Printers' }).click()
  const restoredFilamentEnabled = page.getByRole('region', { name: 'Printer 2' }).getByRole('switch', { name: 'Enabled' })
  await restoredFilamentEnabled.click()
  await expect(restoredFilamentEnabled).toBeChecked()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Printers updated.').last()).toBeVisible()
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
  await expect(page.locator('[data-request-name="filament-block"]')).toHaveCount(1, { timeout: 30_000 })
  await expect(page.locator('[data-request-name="resin-cube"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
  await verify3mfMenuDownload(page, 'workshop-filament-plate-1.3mf')
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
  await expect(page.getByText(/queued model does not fit any enabled printer/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'too-large' })).toHaveCount(0)
  await screenshot(page, 'unsupported-model-planner-desktop')

  await workspaceSettings(page)
  await page.getByRole('link', { name: 'Printers' }).click()
  await removePrinter(page, 'Resin Station')
  await removePrinter(page, 'Resin Backup')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Printers updated.').last()).toBeVisible()
  await mainNav(page, 'Board').click()
  await expect(requestCard(page, 'filament-block')).toContainText('Filament')
  await requestCard(page, 'filament-block').click()
  await expect(page.getByRole('combobox', { name: 'Print type', exact: true })).toContainText('Filament')
  await mobileScreenshot(page, 'single-filament-request-mobile')
  await page.getByRole('button', { name: 'Close' }).click()

  await workspaceSettings(page)
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
  await expect(page.getByText('Printers updated.').last()).toBeVisible()
  await removePrinter(page, 'Workshop Filament')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Printers updated.').last()).toBeVisible()
  await mainNav(page, 'Board').click()
  await expect(requestCard(page, 'filament-block').getByLabel('Fits no enabled printer')).toBeVisible()
  await requestCard(page, 'filament-block').click()
  await expect(page.getByRole('combobox', { name: 'Print type', exact: true })).toContainText('Filament')
  await expect(page.getByText(/Configure at least one filament printer/)).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()

  await workspaceSettings(page)
  await page.getByRole('link', { name: 'Members' }).click()
  await expect(page.getByRole('button', { name: 'Add user' })).toHaveCount(0)
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
  await mainNav(invitePage, 'Account settings').click()
  await expect(invitePage.getByRole('link', { name: 'Members' })).toHaveCount(0)
  await expect(invitePage.getByRole('link', { name: 'Integrations' })).toHaveCount(0)
  await inviteContext.close()

  await page.getByRole('button', { name: 'Close' }).click()
  await mainNav(page, 'Board').click()
  await expect(page.getByRole('button', { name: 'Add a print' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Add a print' })).toBeVisible()
  await expectSessionQueriesToBeHydrated(page)
  await screenshot(page, 'ssr-session-preload-desktop')
  await page.getByRole('button', { name: 'Open account menu' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await page.close()
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
  if (await printType.count()) {
    await expect(printType).toContainText('Resin')
    await choose(printType, values.printType)
  }
  await page.getByRole('button', { name: 'Add 1 print' }).click()
  await expect(requestCard(page, values.name)).toBeVisible({ timeout: 30_000 })
}

function requestCard(page: Page, name: string) {
  return page.locator('button.card').filter({ hasText: name })
}

function mainNav(page: Page, name: 'Board' | 'Planner' | 'Settings' | 'Account settings' | 'About' | 'Admin') {
  return {
    click: async () => {
      if (name === 'Board' || name === 'Planner' || name === 'Settings') {
        await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true }).click()
        return
      }
      await page.getByRole('button', { name: 'Open account menu' }).click()
      await expect(page.getByText('Workspaces', { exact: true })).toBeVisible()
      await page.getByRole('link', { name, exact: true }).click()
    },
  }
}

async function workspaceSettings(page: Page) {
  await mainNav(page, 'Settings').click()
  await expect(page).toHaveURL(/\/settings\/board$/)
}

async function expectSessionQueriesToBeHydrated(page: Page) {
  const sessionQueries = await page.evaluate(() => {
    const queryClient = window.__TSR_ROUTER__.options.context.queryClient
    const session = queryClient.getQueryData(['session', undefined]) as { identity?: { workspaceSlug?: string } } | undefined
    const workspaceSlug = session?.identity?.workspaceSlug
    return { workspaceSlug, workspaceSession: workspaceSlug ? queryClient.getQueryData(['session', workspaceSlug]) : undefined }
  })
  expect(sessionQueries).toMatchObject({ workspaceSlug: expect.any(String), workspaceSession: expect.any(Object) })
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

async function verifyVoxlMenuDownload(page: Page, expectedName: string) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('button', { name: /DragonFruit.*\.voxl/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(expectedName)
  const file = await download.path()
  expect(file).toBeTruthy()
  const bytes = new Uint8Array(await fs.readFile(file))
  expect(strFromU8(bytes.subarray(0, 4))).toBe('VOXL')
}

async function verify3mfMenuDownload(page: Page, expectedName: string) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('button', { name: /3MF.*\.3mf/ }).click()
  const download = await downloadPromise
  await expect3mfDownload(download, expectedName)
}

async function expect3mfDownload(download: import('@playwright/test').Download, expectedName: string) {
  expect(download.suggestedFilename()).toBe(expectedName)
  const file = await download.path()
  expect(file).toBeTruthy()
  const archive = unzipSync(new Uint8Array(await fs.readFile(file)))
  expect(strFromU8(archive['3D/3dmodel.model'])).toContain('<model')
}

async function screenshot(page: Page, name: string) {
  if (!captureScreenshots) return
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true })
}

async function verifyPlannerFillsViewport(page: Page, boardPadding: number) {
  const original = page.viewportSize() ?? { width: 1280, height: 800 }
  await page.setViewportSize({ width: 1920, height: 1080 })
  await expect(page.locator('main').locator('..')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const controls = page.getByRole('heading', { name: 'Printer' }).locator('xpath=ancestor::*[@data-slot="card"]')
  const plate = page.getByRole('heading', { name: /Build plate/ }).locator('xpath=ancestor::*[@data-slot="card"]')
  await expect(plate).toHaveCSS('align-self', 'flex-start')
  const pagePadding = await page.locator('main').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft))
  const [controlsBox, plateBox] = await Promise.all([controls.boundingBox(), plate.boundingBox()])
  expect(pagePadding).toBe(boardPadding)
  expect(controlsBox?.x).toBe(pagePadding)
  expect(plateBox ? 1920 - plateBox.x - plateBox.width : undefined).toBe(pagePadding)
  await screenshot(page, 'plan-next-planner-wide')
  await page.setViewportSize({ width: 1920, height: 1440 })
  const viewer = plate.locator('canvas').locator('..')
  await expect.poll(async () => (await viewer.boundingBox())?.height).toBeGreaterThan(820)
  await screenshot(page, 'plan-next-planner-tall')
  await page.setViewportSize(original)
}

async function mobileScreenshot(page: Page, name: string) {
  if (!captureScreenshots) return
  const original = page.viewportSize() ?? { width: 1280, height: 800 }
  await page.setViewportSize({ width: 320, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await screenshot(page, name)
  await page.setViewportSize(original)
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
