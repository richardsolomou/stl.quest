// Checks, without changing the board, that the demo instance offers everything the README loop acts on, and saves a
// screenshot of each beat for inspection before recording.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { scene, shot, signIn, zone } from './config.ts'

const out = process.env.OUT ?? fileURLToPath(new URL('../../../.capture/verify/', import.meta.url))

fs.mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: scene.width, height: scene.height },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})
const page = await context.newPage()
page.setDefaultTimeout(8000)
const failures: string[] = []
page.on('console', (message) => {
  if (message.type() === 'error') failures.push('console: ' + message.text().slice(0, 200))
})
page.on('pageerror', (error) => failures.push('pageerror: ' + String(error).slice(0, 200)))
page.on('requestfailed', (request) => failures.push('requestfailed: ' + request.url().slice(0, 120)))

await signIn(page)
await page.screenshot({ path: `${out}/10-board.png` })

// The first queued print, with the arrow that moves it up next showing on hover.
await shot.queued(page).hover()
await zone(page, 'todo')
  .getByRole('button', { name: /^Move up next: / })
  .first()
  .waitFor()
await page.screenshot({ path: `${out}/11-queue-hover.png` })

// The print that fires next offers a choice of printers, at least one of them idle.
await shot.start(page).click()
const idle = shot.idlePrinter(page)
const printer = (await idle.locator('span').first().innerText()).trim()
await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/12-start-menu.png` })
await page.keyboard.press('Escape')
await idle.waitFor({ state: 'hidden' })

// That printer's station, which the loop scrolls to once the print starts.
const station = shot.station(page, printer)
await station.scrollIntoViewIfNeeded()
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/13-station.png` })

console.log(`loop starts the next print on ${printer}`)
console.log(failures.length ? 'ISSUES:\n' + [...new Set(failures)].join('\n') : 'no console/network errors')
await browser.close()
