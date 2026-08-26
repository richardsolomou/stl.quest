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
  await expect(page.getByText('Hosted storage value')).toBeVisible()
  await expect(page.getByText('All workspaces look healthy')).toBeVisible()

  await page.goto('/admin/workspaces')
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()
  await page.getByRole('row', { name: 'View details for Preview workspace' }).click()
  const workspaceDetails = page.getByRole('dialog', { name: 'Preview workspace' })
  await expect(workspaceDetails.getByText('Production')).toBeVisible()
  await expect(workspaceDetails.getByRole('heading', { name: 'Members' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/admin/users')
  await page.getByRole('row', { name: 'View details for Preview owner' }).click()
  const accountDetails = page.getByRole('dialog', { name: 'Preview owner' })
  await expect(accountDetails.getByText('Security')).toBeVisible()
  await expect(accountDetails.getByText('Plan and included storage')).toBeVisible()
  await expect(accountDetails.getByText(/Workspaces \(1\)/)).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Actions for Preview owner' }).click()
  await expect(page.getByRole('button', { name: 'View as user' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Change server role' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Set password' })).toBeDisabled()
  await expect(page.getByText('Manage your account from Account settings.')).toBeVisible()
})

test('paginates the admin users table', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Email').fill('preview@stl.quest')
  await page.getByLabel('Password').fill('preview-preview-preview')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: 'Add a print' }).waitFor()
  await page.goto('/admin/users')

  const createResults = await page.evaluate(async () => {
    const results: { status: number; code?: string }[] = []
    for (let index = 1; index <= 10; index += 1) {
      const response = await fetch('/api/auth/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `pagination-${index}@example.com`, name: `Pagination ${index}`, role: 'requester' }),
      })
      const body = (await response.json()) as { code?: string }
      results.push({ status: response.status, code: body.code })
    }
    return results
  })
  expect(createResults.every(({ status, code }) => status === 200 || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL')).toBe(true)
  await page.reload()

  await expect(page.getByText('11 users', { exact: true })).toBeVisible()
  await expect(page.getByText('Page 1 of 2', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible()
  await expect(page.locator('tbody').getByRole('row')).toHaveCount(1)
  await page.getByLabel('Users per page').click()
  await page.getByRole('option', { name: '25 per page' }).click()
  await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible()
  await expect(page.locator('tbody').getByRole('row')).toHaveCount(11)
})
