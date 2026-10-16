import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

const interactiveAuthButton = (page: Page) => page.getByRole('button', { name: /^(Set up STL Quest|Sign in)$/ })

function countDocumentLoads(page: Page) {
  const loads = { count: 0 }
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads.count++
  })
  return loads
}

for (const chunk of ['root', 'AuthMethodIcon']) {
  test(`reloads once when the ${chunk} chunk fails during first load`, async ({ page }) => {
    await page.route(`**/assets/${chunk}-*.js`, (route) => route.fulfill({ status: 502, body: 'Bad Gateway' }), { times: 1 })
    const loads = countDocumentLoads(page)

    await page.goto('/')

    await expect(interactiveAuthButton(page)).toBeEnabled()
    expect(loads.count).toBe(2)
  })
}

test('stops reloading and offers a refresh when a chunk keeps failing', async ({ page }) => {
  await page.route('**/assets/root-*.js', (route) => route.fulfill({ status: 502, body: 'Bad Gateway' }))
  const loads = countDocumentLoads(page)

  await page.goto('/')

  await expect(page.getByText('STL Quest couldn’t finish loading.')).toBeVisible()
  expect(loads.count).toBe(2)
})

test('ignores a failing module script from another origin', async ({ page }) => {
  // Like a browser extension's script, which the CSP blocks before it can load.
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const script = document.createElement('script')
      script.type = 'module'
      script.src = 'https://extension.invalid/inject.js'
      script.onerror = () => document.documentElement.setAttribute('data-foreign-script-failed', '')
      document.head.append(script)
    })
  })
  const loads = countDocumentLoads(page)

  await page.goto('/')

  await expect(page.locator('html[data-foreign-script-failed]')).toBeAttached()
  await expect(interactiveAuthButton(page)).toBeEnabled()
  await expect(page.getByText('STL Quest couldn’t finish loading.')).toBeHidden()
  expect(loads.count).toBe(1)
})

test('offers a refresh instead of reloading when a chunk fails after the page is interactive', async ({ page }) => {
  const loads = countDocumentLoads(page)
  await page.goto('/')
  await expect(interactiveAuthButton(page)).toBeEnabled()

  await page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError', { cancelable: true })))

  await expect(page.getByText('STL Quest has been updated.')).toBeVisible()
  expect(loads.count).toBe(1)
})
