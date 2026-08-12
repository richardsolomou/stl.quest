import { expect, test } from '@playwright/test'
import { boxStl } from './fixtures/stl'

test('seeds a disposable preview workspace', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Set up STL Quest' })).toHaveCount(0)
  await page.getByLabel('Email').fill('preview@stl.quest')
  await page.getByLabel('Password').fill('preview-preview-preview')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: 'Add a print' }).waitFor()

  await expect(page.locator('button.card').filter({ hasText: 'Calibration cube' }).first()).toContainText('Resin')
  await expect(page.locator('button.card').filter({ hasText: 'Replacement bracket' }).first()).toContainText(/Filament.*×2|×2.*Filament/)
  await expect(page.locator('button.card').filter({ hasText: 'Tabletop miniatures' }).first()).toContainText(/Resin.*×4|×4.*Resin/)

  const observerContext = await browser.newContext({ baseURL })
  const observer = await observerContext.newPage()
  const realtimeConnection = observer.waitForEvent(
    'websocket',
    (websocket) => new URL(websocket.url()).pathname === '/connection/websocket',
  )
  await observer.goto('/')
  await observer.getByLabel('Email').fill('preview@stl.quest')
  await observer.getByLabel('Password').fill('preview-preview-preview')
  await observer.getByRole('button', { name: 'Sign in' }).click()
  await realtimeConnection

  const realtimeRequest = `Preview realtime ${Date.now()}`
  await page.getByRole('button', { name: 'Add a print' }).click()
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'preview-realtime.stl', mimeType: 'model/stl', buffer: boxStl('preview-realtime', 10, 10, 10) })
  await page.getByLabel('Name').fill(realtimeRequest)
  await page.getByRole('button', { name: 'Add 1 print' }).click()
  await expect(observer.locator('button.card').filter({ hasText: realtimeRequest })).toBeVisible()
  await observerContext.close()

  await page.goto('/admin/users')
  await expect(page.getByRole('columnheader', { name: /Created/ })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /Updated/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Last online/ }).locator('.lucide-arrow-down')).toBeVisible()
  await page.getByRole('button', { name: 'Columns' }).click()
  await page.getByText('Updated', { exact: true }).click()
  await expect(page.getByRole('columnheader', { name: /Updated/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('columnheader', { name: /Updated/ })).toBeVisible()
  await page.getByRole('button', { name: /Created/ }).click()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('stlquest:super-admin-users:sorting')))
    .toBe('[{"id":"createdAt","desc":true}]')
  await page.reload()
  await expect(page.getByRole('button', { name: /Created/ }).locator('.lucide-arrow-down')).toBeVisible()

  await page.goto('/admin/overview')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByText('Print requests')).toBeVisible()
  await expect(page.getByText('Managed storage')).toBeVisible()

  await page.goto('/admin/workspaces')
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()
  await page.getByRole('row', { name: 'View details for Preview workspace' }).click()
  const workspaceDetails = page.getByRole('dialog', { name: 'Preview workspace' })
  await expect(workspaceDetails.getByText('Production')).toBeVisible()
  await expect(workspaceDetails.getByRole('heading', { name: 'Members' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/admin/users')
  await page.getByRole('button', { name: 'View details' }).click()
  const accountDetails = page.getByRole('dialog', { name: 'Preview owner' })
  await expect(accountDetails.getByText('Security')).toBeVisible()
  await expect(accountDetails.getByText(/Workspaces \(1\)/)).toBeVisible()
})
