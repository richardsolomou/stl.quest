// Scripted screen recording of the demo board: `pnpm tour:gif` writes .capture/product-tour.gif, the short loop the
// README shows.
//
// Assumes the demo data is seeded and a server is running (see docs/development/product-tour-capture.md). Playwright drives
// the UI, so motion is identical on every take — no shaky mouse, no mistimed clicks.
//
// Recording happens in a second browser context created from a saved session, so the sign-in screen never appears in
// the footage.

import { chromium, type BrowserContext, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { config, scene, shot, signIn, zone } from './config.ts'
import { encodeGif } from './media.ts'

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Playwright does not draw a pointer into the recording, so a click reads as the UI moving on its own. This overlay
// follows the same synthetic events the script dispatches.
async function installCursor(context: BrowserContext) {
  await context.addInitScript(() => {
    const draw = () => {
      const dot = document.createElement('div')
      dot.id = '__cursor'
      dot.style.cssText = [
        'position:fixed',
        'top:0',
        'left:0',
        'width:22px',
        'height:22px',
        'margin:-11px 0 0 -11px',
        'border-radius:50%',
        'background:rgba(255,255,255,0.9)',
        'box-shadow:0 0 0 2px rgba(0,0,0,0.55), 0 3px 12px rgba(0,0,0,0.5)',
        'pointer-events:none',
        'z-index:2147483647',
        'transition:transform 90ms ease-out, background 120ms ease-out',
      ].join(';')
      document.body.appendChild(dot)
      const press = (held: boolean) => (dot.style.background = held ? 'rgba(245,158,11,0.95)' : 'rgba(255,255,255,0.9)')
      addEventListener('mousemove', (event) => (dot.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`), true)
      addEventListener('mousedown', () => press(true), true)
      addEventListener('mouseup', () => press(false), true)
    }
    if (document.body) draw()
    else addEventListener('DOMContentLoaded', draw)
  })
}

// A single mouse.move jumps the pointer. Stepping it makes the motion readable on camera.
async function glideTo(page: Page, locator: Locator, offsetX = 0.5, offsetY = 0.5) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element is not visible')
  await page.mouse.move(box.x + box.width * offsetX, box.y + box.height * offsetY, { steps: 10 })
  return box
}

async function clickSlowly(page: Page, locator: Locator, settle = 320) {
  await glideTo(page, locator)
  await pause(120)
  await locator.click()
  await pause(settle)
}

// Wheel steps rather than scrollIntoView, so the scroll follows the cursor like a person scrolling the column. Every
// scrolled frame redraws the whole GIF frame, so the scroll is brisk.
async function scrollTo(page: Page, locator: Locator, top: number) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element is not visible')
  await page.mouse.move(box.x + box.width / 2, Math.min(box.y, scene.height * 0.7), { steps: 10 })
  const steps = 5
  for (let step = 0; step < steps; step++) await page.mouse.wheel(0, (box.y - top) / steps)
  await pause(400)
}

const advanceName = async (button: Locator, action: string) => {
  const label = await button.getAttribute('aria-label')
  if (!label?.startsWith(`${action}: `)) throw new Error(`expected a "${action}" button, found "${label}"`)
  return label.slice(action.length + 2)
}

// One print moves up from the queue, then the print that fires next goes the rest of the way: started on an idle
// printer, taken off it, and marked ready. Each step uses the card's own advance action, the way the board is worked.
async function gif(page: Page) {
  await pause(600)
  const queued = shot.queued(page)
  await glideTo(page, queued, 0.6)
  await pause(300)
  await clickSlowly(
    page,
    zone(page, 'todo')
      .getByRole('button', { name: /^Move up next: / })
      .first(),
    900,
  )

  await clickSlowly(page, shot.start(page), 450)
  const idle = shot.idlePrinter(page)
  const printer = (await idle.locator('span').first().innerText()).trim()
  await clickSlowly(page, idle, 700)

  // The stations sit below Up next; scroll the started printer up under the sticky Printing heading.
  const station = shot.station(page, printer)
  await scrollTo(page, station, 240)
  const off = station.getByRole('button', { name: /^Off the printer: / })
  const name = await advanceName(off, 'Off the printer')
  await clickSlowly(page, off, 900)

  await clickSlowly(page, zone(page, 'post_processing').getByRole('button', { name: `Mark ready: ${name}` }), 300)
  await zone(page, 'done').locator('.card').filter({ hasText: name }).first().waitFor()
  await pause(1700)
}

async function record() {
  fs.mkdirSync(config.outputDirectory, { recursive: true })
  fs.rmSync(config.workDirectory, { recursive: true, force: true })
  fs.mkdirSync(config.workDirectory, { recursive: true })

  const viewport = { width: scene.width, height: scene.height }
  let start = 0
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] })
  try {
    // Sign in once in a throwaway context so the recording never shows the login screen; its wait on the board also
    // gives the server time to render model thumbnails before the take.
    const setup = await browser.newContext({ viewport })
    const login = await setup.newPage()
    await signIn(login, 5_000)
    const state = await setup.storageState()
    await setup.close()

    const context = await browser.newContext({
      viewport,
      storageState: state,
      recordVideo: { dir: config.workDirectory, size: viewport },
      reducedMotion: 'no-preference',
      colorScheme: 'dark',
    })
    await installCursor(context)
    const page = await context.newPage()
    // Video capture begins with the page, so offsets measured from here line up with the recording.
    const recordingStart = Date.now()
    // Well below Playwright's 30 s default: a missed selector should fail the take, not silently add half a minute of
    // dead air to the footage.
    page.setDefaultTimeout(8000)
    await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' })
    await shot.queued(page).waitFor()
    await page.waitForTimeout(1500)
    // The loop opens on the settled board; everything before it is page load.
    start = (Date.now() - recordingStart) / 1000
    await gif(page)

    await page.close()
    await context.close()
  } finally {
    await browser.close()
  }

  const source = fs.readdirSync(config.workDirectory).find((file) => file.endsWith('.webm'))
  if (!source) throw new Error('playwright produced no video')
  return await encodeGif(path.join(config.workDirectory, source), start)
}

console.log('recording…')
const file = await record()
console.log(`wrote ${file}\n  ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MiB`)
