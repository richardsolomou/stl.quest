import type { Locator, Page } from '@playwright/test'
import { expect } from './test'

export async function expectTablesFitWidth(page: Page) {
  const tables = page.locator('[data-slot="table-container"]')
  await expect(tables.first()).toBeVisible()
  await expect
    .poll(() => tables.evaluateAll((elements) => Math.max(...elements.map((element) => element.scrollWidth - element.clientWidth))))
    .toBe(0)
}

// Measured without scrolling, because clicking or scrollIntoView would also scroll a sideways-overflowing table.
export async function expectWithinViewportWidth(page: Page, locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
}
