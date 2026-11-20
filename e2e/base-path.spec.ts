import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/test'
import { boxStl } from './fixtures/stl'

const email = 'base-path-owner@example.com'
const password = 'correct-horse-battery-staple'

// `baseURL` ends in `/stlquest/`, so every navigation is relative; a leading slash would leave the base path.
test('serves the whole application under a base path', async ({ page, browser, baseURL }) => {
  const outside = trackRequestsOutside(page, new URL(baseURL!))

  await page.goto('./')
  await page.getByRole('button', { name: 'Set up STL Quest' }).click()
  await expect(page.locator('form[data-hydrated="true"]')).toBeVisible()
  await page.getByLabel('Name').fill('Base Path Owner')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create super admin' }).click()
  await page.getByRole('button', { name: 'Use this folder' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('region', { name: 'Board filters' }).getByRole('button', { name: 'Add a print' })).toBeVisible()

  const observerContext = await browser.newContext({ baseURL })
  const observer = await observerContext.newPage()
  const realtimeConnection = observer.waitForEvent(
    'websocket',
    (websocket) => new URL(websocket.url()).pathname === '/stlquest/connection/websocket',
  )
  await observer.goto('./')
  await expect(observer.locator('form[data-hydrated="true"]')).toBeVisible()
  await observer.getByLabel('Email').fill(email)
  await observer.getByLabel('Password').fill(password)
  await observer.getByRole('button', { name: 'Sign in' }).click()
  await expect(observer.getByRole('region', { name: 'Board filters' }).getByRole('button', { name: 'Add a print' })).toBeVisible()
  await realtimeConnection

  await page.getByRole('region', { name: 'Board filters' }).getByRole('button', { name: 'Add a print' }).click()
  await page.getByRole('button', { name: 'Upload files' }).click()
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'base-path.stl', mimeType: 'model/stl', buffer: boxStl('base-path', 10, 10, 10) })
  await page.getByLabel('Name').fill('Base path print')
  await page.getByRole('button', { name: 'Add 1 print' }).click()

  await expect(observer.locator('button.card').filter({ hasText: 'Base path print' })).toBeVisible()
  await observerContext.close()
  expect(outside).toEqual([])
})

function trackRequestsOutside(page: Page, base: URL) {
  const outside: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin === base.origin && !url.pathname.startsWith(base.pathname)) outside.push(url.pathname)
  })
  return outside
}
