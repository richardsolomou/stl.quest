import type { Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const captureDirectory = fileURLToPath(new URL('../../../.capture/', import.meta.url))

export const config = {
  baseUrl: process.env.BASE ?? 'http://localhost:3001',
  email: process.env.DEMO_EMAIL ?? 'richard@stl.quest',
  password: process.env.DEMO_PASSWORD ?? 'demo-demo-demo',
  outputDirectory: captureDirectory,
  workDirectory: path.join(captureDirectory, '.work'),
}

// The viewport is the board at a common laptop size; `scale` delivers it at the README's display width, and `speed`
// compresses the still gaps Playwright leaves around each action.
export const scene = { width: 1440, height: 900, scale: '1200:-1', speed: 1.3 } as const

export async function signIn(page: Page, settle = 4_000) {
  await page.goto(config.baseUrl, { waitUntil: 'networkidle' })
  await page.getByLabel(/email/i).first().fill(config.email)
  await page
    .getByLabel(/password/i)
    .first()
    .fill(config.password)
  await page
    .getByRole('button', { name: /sign in/i })
    .first()
    .click()
  await page.waitForTimeout(settle)
}

export const zone = (page: Page, status: string) => page.locator(`.zone[data-status="${status}"]`)

// The scene follows positions rather than names, so it works on any demo data with a full queue, several idle
// printers, and room at the top of the shelves: the first queued print, the print that fires next, and the first idle
// printer offered for it.
export const shot = {
  queued: (page: Page) => zone(page, 'todo').locator('.card').first(),
  start: (page: Page) => zone(page, 'up_next').getByRole('button', { name: 'Start printing', exact: true }),
  idlePrinter: (page: Page) => page.getByRole('menuitem').filter({ hasText: /idle/i }).first(),
  station: (page: Page, printer: string) =>
    page
      .locator('[data-station]')
      .filter({ has: page.getByText(printer, { exact: true }) })
      .first(),
}
