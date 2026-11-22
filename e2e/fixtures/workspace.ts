import type { Page } from '@playwright/test'
import { expect } from './test'

export const password = 'correct-horse-battery-staple'

/** Signs in as the owner the isolated specs share, setting the deployment up with one resin printer on first use. */
export async function enterAdminWorkspace(page: Page) {
  await page.goto('/')
  const setupButton = page.getByRole('button', { name: 'Set up STL Quest' })
  const signInButton = page.getByRole('button', { name: 'Sign in', exact: true })
  await expect(setupButton.or(signInButton)).toBeVisible()
  if (await signInButton.isVisible()) {
    await expect(page.locator('form[data-hydrated="true"]')).toBeVisible()
    await page.getByLabel('Email').fill('owner@example.com')
    await page.getByLabel('Password').fill(password)
    await signInButton.click()
    await expect(page.getByRole('region', { name: 'Board filters' }).getByRole('button', { name: 'Add a print' })).toBeVisible()
    return
  }

  await setupButton.click()
  await page.getByLabel('Name').fill('Owner')
  await page.getByLabel('Email').fill('owner@example.com')
  await page.getByLabel('Password').fill(password)
  await page.getByLabel('Password').press('Enter')
  await page.getByRole('button', { name: 'Use this folder' }).click()
  if (!(await page.getByRole('button', { name: /^Edit / }).count())) {
    await page.getByRole('button', { name: 'Add printer' }).click()
    await page.getByRole('button', { name: 'Custom printer' }).click()
    await page.getByLabel('Name', { exact: true }).fill('Resin printer')
    await page.getByRole('button', { name: 'Done' }).click()
  }
  await page.getByRole('button', { name: 'Save and continue' }).click()
}
