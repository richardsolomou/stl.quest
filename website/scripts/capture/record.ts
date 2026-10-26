// Scripted screen recordings of the demo board.
//
//   pnpm website:capture:video   → website/.capture/landing.mp4  (long cut, 1080p)
//   pnpm website:capture:gif     → website/.capture/product-tour.gif  (short loop for GitHub)
//
// Assumes the demo data is seeded and a server is running (see docs/product-tour-capture.md). Playwright drives
// the UI, so motion is identical on every take — no shaky mouse, no mistimed clicks.
//
// Recording happens in a second browser context created from a saved session, so the sign-in screen
// never appears in the footage. Video is captured at twice the delivered resolution and downscaled
// by ffmpeg, which is what keeps small text crisp.

import { chromium, type BrowserContext, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { config, isSceneName, scenes, signIn, type SceneName } from './config.ts'
import { encodeRecording, type Marks } from './media.ts'

// `speed` gently compresses the finished timeline — Playwright leaves a still gap around every
// action while it resolves locators and runs actionability checks. `orbitSpeed` is applied on top of
// that, to the model rotation only: the orbit is the one stretch where nothing is being demonstrated
// beat by beat, so it can run fast without becoming unreadable.
type Mark = (label: string) => void

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Playwright does not draw a pointer into the recording, so a click or a drag reads as the UI moving
// on its own. This overlay follows the same synthetic events the script dispatches.
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
      const move = (event: Event) => {
        if (!(event instanceof MouseEvent)) return
        // The final `drag`/`dragend` pair reports 0,0 in Chromium; honouring it would fling the
        // cursor into the corner at the end of every drop.
        if (!event.clientX && !event.clientY) return
        dot.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`
      }
      // The board uses the native HTML5 drag API (via pragmatic-drag-and-drop). Once a drag session
      // starts the browser stops firing `mousemove` entirely and emits `drag`/`dragover` instead, so
      // tracking only `mousemove` leaves the cursor parked while a card flies across the board.
      for (const type of ['mousemove', 'drag', 'dragover']) addEventListener(type, move, true)
      addEventListener('mousedown', () => press(true), true)
      addEventListener('dragstart', () => press(true), true)
      for (const type of ['mouseup', 'dragend', 'drop']) addEventListener(type, () => press(false), true)
    }
    if (document.body) draw()
    else addEventListener('DOMContentLoaded', draw)
  })
}

// A single mouse.move jumps the pointer. Stepping it makes the motion readable on camera.
// Keep step counts modest: every synthetic move is a CDP round trip, and over the 3D canvas each one
// also forces a WebGL re-render, so a high count turns a two-second orbit into a minute of footage.
async function glide(page: Page, x: number, y: number, steps = 10) {
  await page.mouse.move(x, y, { steps })
}

async function glideTo(page: Page, locator: Locator, offsetX = 0.5, offsetY = 0.5) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element is not visible')
  await glide(page, box.x + box.width * offsetX, box.y + box.height * offsetY)
  return box
}

// One beat between actions. The cut should read as someone working quickly, not demonstrating
// slowly, so nothing here should idle for longer than this.
const beat = (ms = 260) => pause(ms)

async function clickSlowly(page: Page, locator: Locator, settle = 320) {
  await glideTo(page, locator)
  await pause(120)
  await locator.click()
  await pause(settle)
}

async function typeSlowly(page: Page, locator: Locator, text: string, delay = 55) {
  await glideTo(page, locator)
  await locator.click()
  await locator.pressSequentially(text, { delay })
}

async function rightClick(page: Page, locator: Locator, settle = 300) {
  await glideTo(page, locator)
  await pause(120)
  await locator.click({ button: 'right' })
  await pause(settle)
}

async function menuItem(page: Page, name: string, settle = 420) {
  const item = page.getByRole('menuitem', { name, exact: true }).first()
  await clickSlowly(page, item, settle)
}

const cardIn = (page: Page, status: string, name: string) =>
  page.locator(`[data-status="${status}"] .card`).filter({ hasText: name }).first()

// pragmatic-drag-and-drop needs intermediate move events; a straight down/up does nothing.
// A card scrolled out of its column still reports a bounding box, so without the scroll and the
// check at the end a failed drag looks exactly like a successful one in the finished recording.
// `dropAt` is a fraction of the column height. Plate groups sit at the top of a column, so dropping
// near the top drops *into* a group, which opens the "Move copies" prompt and derails the shot.
async function dragCard(page: Page, name: string, from: string, to: string, dropAt = 0.62) {
  const card = page.locator(`[data-status="${from}"] .card`).filter({ hasText: name }).first()
  const target = page.locator(`[data-status="${to}"] .column-body`).first()
  await card.scrollIntoViewIfNeeded()
  await pause(160)
  const cardBox = await card.boundingBox()
  const targetBox = await target.boundingBox()
  if (!cardBox || !targetBox) throw new Error(`cannot drag "${name}" from ${from} to ${to}`)
  await glide(page, cardBox.x + 40, cardBox.y + 34)
  await pause(140)
  await page.mouse.down()
  await pause(120)
  await page.mouse.move(cardBox.x + 70, cardBox.y + 10, { steps: 6 })
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * dropAt, { steps: 16 })
  await pause(240)
  await page.mouse.up()
  await pause(480)
  // Multi-copy requests ask how many to move; accept the default so the board settles.
  const dialog = page.getByRole('dialog', { name: 'Move copies' })
  if (await dialog.isVisible().catch(() => false)) {
    await clickSlowly(page, dialog.getByRole('button', { name: 'Move', exact: true }), 500)
  }
  const landed = await page
    .locator(`[data-status="${to}"] .card`)
    .filter({ hasText: name })
    .first()
    .isVisible()
    .catch(() => false)
  if (!landed) throw new Error(`drag of "${name}" from ${from} to ${to} did not take effect`)
}

// Every Playwright mouse event costs a CDP round trip — measured at ~670 ms each over this canvas —
// so a scripted drag-orbit renders as a slideshow. OrbitControls (three-stdlib) takes `pointerdown`
// on the canvas and `pointermove`/`pointerup` on the owning document, so the sweep is dispatched from
// inside the page on requestAnimationFrame instead, which orbits at the real frame rate.
// `mousemove` goes out alongside it purely so the cursor overlay keeps up.
async function orbitModel(page: Page, milliseconds = 4200) {
  await page.evaluate(async (duration) => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return
    const box = canvas.getBoundingClientRect()
    const centreY = box.top + box.height / 2
    const startX = box.left + box.width / 2
    const emit = (type: string, x: number, y: number, target: EventTarget, extra: PointerEventInit = {}) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          bubbles: true,
          cancelable: true,
          ...extra,
        }),
      )
    emit('pointerdown', startX, centreY, canvas, { button: 0, buttons: 1 })
    const started = performance.now()
    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        const progress = Math.min(1, (now - started) / duration)
        // Constant angular velocity. An ease that slows at the ends, or a there-and-back sweep that
        // reverses in the middle, reads as the video freezing at each turning point.
        const x = startX + (progress - 0.35) * box.width * 0.9
        const y = centreY + Math.sin(progress * Math.PI) * 14
        emit('pointermove', x, y, document, { button: -1, buttons: 1 })
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }))
        if (progress < 1) requestAnimationFrame(frame)
        else resolve()
      }
      requestAnimationFrame(frame)
    })
    emit('pointerup', startX, centreY, document, { button: 0, buttons: 0 })
  }, milliseconds)
}

// Escape is not reliable here: the request modal treats an Escape with pending edits as "discard?"
// and opens a nested confirm, which then swallows the key and leaves the dialog on screen for the
// rest of the take. Click the real close control and confirm the dialog actually went away.
async function closeModal(page: Page) {
  const dialog = page.getByRole('dialog').first()
  if (!(await dialog.isVisible().catch(() => false))) return
  await clickSlowly(page, dialog.getByRole('button', { name: 'Close' }).first(), 200)
  const discard = page.getByRole('button', { name: /^discard$/i }).first()
  if (await discard.isVisible().catch(() => false)) await clickSlowly(page, discard, 400)
  await dialog.waitFor({ state: 'hidden', timeout: 6000 })
  await pause(180)
}

// Roughly one action per second, with no idle stretches. Every beat is a distinct capability.
async function landing(page: Page, mark: Mark) {
  await pause(400)

  // Search narrows every column at once.
  const search = page.getByPlaceholder(/search prints/i)
  await typeSlowly(page, search, 'wraith')
  await beat(600)
  await search.fill('')
  await beat(450)

  // Re-order the queue: fair round-robin between requesters, then back.
  await clickSlowly(page, page.getByRole('button', { name: /sort/i }).first())
  await clickSlowly(page, page.getByRole('menuitemradio', { name: 'Round robin' }).first(), 600)
  await clickSlowly(page, page.getByRole('button', { name: /sort/i }).first())
  await clickSlowly(page, page.getByRole('menuitemradio', { name: 'Requester priorities' }).first(), 500)

  // Right-click a card, select a few, and tag the selected copies as one overnight run.
  await rightClick(page, cardIn(page, 'up_next', 'Plasmancer'))
  await menuItem(page, 'Select')
  await clickSlowly(page, cardIn(page, 'up_next', 'Chronomancer'), 220)
  await clickSlowly(page, cardIn(page, 'up_next', 'Hexmark Destroyer'), 220)
  await rightClick(page, cardIn(page, 'up_next', 'Plasmancer'))
  await menuItem(page, 'Manage tags', 500)
  const tags = page.getByRole('dialog', { name: 'Tag prints' })
  const tagSearch = tags.getByLabel('Find or create tags')
  await typeSlowly(page, tagSearch, 'Overnight run', 45)
  await tagSearch.press('Enter')
  await pause(650)
  await clickSlowly(page, tags.getByRole('button', { name: 'Done' }), 500)

  // Single cards across stages.
  await dragCard(page, 'Lokhust Heavy', 'up_next', 'in_progress')
  await dragCard(page, 'Skorpekh Lord', 'in_progress', 'post_processing')

  // Move by dialog rather than by drag, splitting the copies.
  await rightClick(page, cardIn(page, 'todo', 'Void Dragon'))
  await menuItem(page, 'Move', 400)
  const moveDialog = page.getByRole('dialog', { name: 'Move copies' })
  await clickSlowly(page, moveDialog.getByRole('button', { name: 'Move', exact: true }), 500)

  // The 3D viewer. Most of this segment should be the model turning: the open, the settle, and the
  // close are all hold time, so keep them short and let the orbit fill the shot.
  await clickSlowly(
    page,
    cardIn(page, 'todo', 'Nightbringer')
      .or(page.locator('.card').filter({ hasText: 'Nightbringer' }))
      .first(),
    500,
  )
  // The fast slice starts here rather than at the orbit itself: decoding the compressed mesh takes a
  // few seconds on first open, and that wait is dead air belonging to the same shot.
  mark('orbit-start')
  const canvas = page.locator('canvas').first()
  await canvas.waitFor({ state: 'visible' })
  await glideTo(page, canvas)
  await orbitModel(page, 7000)
  mark('orbit-end')
  await beat(150)
  await closeModal(page)

  // Filter the board down, then clear it again.
  await clickSlowly(page, page.getByRole('button', { name: /filters/i }).first(), 500)
  await clickSlowly(page, page.getByRole('combobox').first(), 350)
  await clickSlowly(page, page.getByRole('option', { name: 'Resin' }).first(), 700)
  await clickSlowly(page, page.getByRole('button', { name: /^done$/i }).first(), 700)
  await clickSlowly(page, page.getByRole('button', { name: /filters/i }).first(), 400)
  await clickSlowly(page, page.getByRole('button', { name: /reset all filters/i }).first(), 500)
  await clickSlowly(page, page.getByRole('button', { name: /^done$/i }).first(), 600)

  // Closing frame: back on the full board.
  await pause(1900)
}

// Two short left-to-right moves: work flowing along the pipeline. Both cards are single-copy and sit
// high in their column, so nothing scrolls and no copy-count prompt interrupts the motion.
async function gif(page: Page) {
  await pause(900)
  await dragCard(page, 'Hexmark Destroyer', 'up_next', 'in_progress')
  await pause(700)
  await dragCard(page, 'Skorpekh Lord', 'in_progress', 'post_processing')
  await pause(1300)
}

async function record(name: SceneName) {
  const scene = scenes[name]
  const sceneMarks: Marks = {}
  fs.mkdirSync(config.outputDirectory, { recursive: true })
  fs.rmSync(config.workDirectory, { recursive: true, force: true })
  fs.mkdirSync(config.workDirectory, { recursive: true })

  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] })
  try {
    // Sign in once in a throwaway context so the recording never shows the login screen.
    const setup = await browser.newContext({ viewport: { width: scene.width, height: scene.height } })
    const login = await setup.newPage()
    await signIn(login, 5_000)
    const state = await setup.storageState()
    await setup.close()

    const context = await browser.newContext({
      viewport: { width: scene.width, height: scene.height },
      storageState: state,
      recordVideo: { dir: config.workDirectory, size: { width: scene.width, height: scene.height } },
      reducedMotion: 'no-preference',
    })
    await installCursor(context)
    const page = await context.newPage()
    // Video capture begins with the page, so offsets measured from here line up with the recording.
    const recordingStart = Date.now()
    const marks: Marks = {}
    const mark = (label: string) => (marks[label] = (Date.now() - recordingStart) / 1000)
    // Well below Playwright's 30 s default: a missed selector should fail the take, not silently add
    // half a minute of dead air to the footage.
    page.setDefaultTimeout(8000)
    await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)

    if (name === 'landing') await landing(page, mark)
    else await gif(page)
    Object.assign(sceneMarks, marks)

    await page.close()
    await context.close()
  } finally {
    await browser.close()
  }

  const source = fs.readdirSync(config.workDirectory).find((file) => file.endsWith('.webm'))
  if (!source) throw new Error('playwright produced no video')
  const output = await encodeRecording(name, path.join(config.workDirectory, source), sceneMarks)
  console.log(`wrote ${output}`)
  return output
}

const scene = process.argv[2]
// Recording one scene leaves the board changed, so two scenes back to back need a reseed in between.
// Reseed the demo data between scenes; this script deliberately handles one scene per run.
if (!isSceneName(scene)) throw new Error(`usage: record.ts <${Object.keys(scenes).join('|')}>`)
console.log(`recording ${scene}…`)
const file = await record(scene)
console.log(`  ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MiB`)
