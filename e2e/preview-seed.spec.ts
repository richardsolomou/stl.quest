import { expect, test } from '@playwright/test'

test('seeds a disposable preview workspace', async ({ page }) => {
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
})
