import { chromium } from '@playwright/test'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { config, signIn } from './config.ts'

const out = process.env.OUT ?? fileURLToPath(new URL('../../.capture/verify/', import.meta.url))

fs.mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const failures: string[] = []
page.on('console', (message) => {
  if (message.type() === 'error') failures.push('console: ' + message.text().slice(0, 200))
})
page.on('pageerror', (error) => failures.push('pageerror: ' + String(error).slice(0, 200)))
page.on('requestfailed', (request) => failures.push('requestfailed: ' + request.url().slice(0, 120)))

await signIn(page)

// A request that has a compressed 3D preview: the viewer is the centrepiece of the video.
await page.getByText('Nightbringer', { exact: true }).first().click()
await page.waitForTimeout(4000)
await page.screenshot({ path: `${out}/10-detail-viewer.png` })
await page.keyboard.press('Escape')
await page.waitForTimeout(800)

// The deliberately over-sized model, to confirm the plate-fit warning renders.
await page.getByPlaceholder(/search prints/i).fill('Void Dragon')
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/11-search-voiddragon.png` })
await page.getByText('Void Dragon', { exact: true }).first().click()
await page.waitForTimeout(3500)
await page.screenshot({ path: `${out}/12-fit-warning.png` })
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
await page.getByPlaceholder(/search prints/i).fill('')
await page.waitForTimeout(1200)

// Filters panel: requester facets and print-type filtering.
await page
  .getByRole('button', { name: /filters/i })
  .first()
  .click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${out}/13-filters.png` })
await page.keyboard.press('Escape')
await page.waitForTimeout(600)

// Printer fleet in settings.
await page.goto(`${config.baseUrl}/settings/printers`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
await page.screenshot({ path: `${out}/14-printers.png`, fullPage: true })

await page.goto(`${config.baseUrl}/settings/members`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
await page.screenshot({ path: `${out}/15-members.png`, fullPage: true })

// Mobile.
const mobile = await browser.newContext({ viewport: { width: 320, height: 720 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
const small = await mobile.newPage()
await signIn(small, 4_500)
await small.screenshot({ path: `${out}/16-mobile.png` })

console.log(failures.length ? 'ISSUES:\n' + [...new Set(failures)].join('\n') : 'no console/network errors')
await browser.close()
