import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/test'
import { enterAdminWorkspace, password } from './fixtures/workspace'

/** Holds every script request until the returned function runs, so a test can type into the server-rendered page first. */
async function holdScripts(page: Page) {
  let release = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/\.m?js(\?|$)/, async (route) => {
    await released
    await route.continue()
  })
  return release
}

test('keeps what was typed into the sign-in form before hydration', async ({ browser, page }) => {
  await enterAdminWorkspace(page)
  const context = await browser.newContext()
  const visitor = await context.newPage()
  const releaseScripts = await holdScripts(visitor)

  await visitor.goto('/', { waitUntil: 'commit' })
  await expect(visitor.locator('form[data-hydrated="false"]')).toBeVisible()
  await visitor.getByLabel('Email').fill('owner@example.com')
  await visitor.getByLabel('Password').fill(password)
  releaseScripts()
  await expect(visitor.locator('form[data-hydrated="true"]')).toBeVisible()

  await expect(visitor.getByLabel('Email')).toHaveValue('owner@example.com')
  if (process.env.CAPTURE_E2E_SCREENSHOTS === '1') await visitor.screenshot({ path: 'test-results/sign-in-typed-before-hydration.png' })
  await visitor.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(visitor.getByRole('region', { name: 'Board filters' }).getByRole('button', { name: 'Add a print' })).toBeVisible()
  await context.close()
})

test('keeps what was typed into the invite form before hydration', async ({ browser, page }) => {
  await enterAdminWorkspace(page)
  await page.goto('/settings/users')
  await page.getByRole('button', { name: 'Invite user' }).click()
  await page.getByRole('button', { name: 'Create invite link' }).click()
  const inviteUrl = await page.locator('#invite-link').inputValue()
  const context = await browser.newContext()
  const invitee = await context.newPage()
  const releaseScripts = await holdScripts(invitee)

  await invitee.goto(inviteUrl, { waitUntil: 'commit' })
  await expect(invitee.locator('form[data-hydrated="false"]')).toBeVisible()
  await invitee.getByLabel('Name').fill('Early Typist')
  await invitee.getByLabel('Email').fill('early-typist@example.com')
  await invitee.getByLabel('Password').fill(password)
  releaseScripts()
  await expect(invitee.locator('form[data-hydrated="true"]')).toBeVisible()

  await expect(invitee.getByLabel('Email')).toHaveValue('early-typist@example.com')
  await invitee.getByRole('button', { name: 'Create account' }).click()
  await expect(invitee.getByRole('region', { name: 'Board filters' })).toBeVisible()
  await context.close()
})
