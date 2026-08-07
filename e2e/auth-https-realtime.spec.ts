import { execFile as execFileCallback } from 'node:child_process'
import { request } from 'node:https'
import { promisify } from 'node:util'
import { expect, type Page, test } from '@playwright/test'
import { boxStl } from './fixtures/stl'

const email = 'https-owner@example.com'
const password = 'correct-horse-battery-staple'
const execFile = promisify(execFileCallback)

test('authenticates and receives realtime updates through an HTTPS proxy', async ({ page, browser, baseURL }) => {
  const publicURL = new URL(baseURL!)
  expect(await foreignOriginStatus(publicURL)).toBe(403)

  await page.goto('/')
  await page.getByRole('button', { name: 'Set up STL Quest' }).click()
  await page.getByLabel('Name').fill('HTTPS Owner')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create super admin' }).click()
  await page.getByRole('button', { name: 'Use this folder' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('button', { name: 'Add a print' })).toBeVisible()

  await page.context().clearCookies()
  await page.reload()
  await signIn(page)

  const observerContext = await browser.newContext({ baseURL, ignoreHTTPSErrors: true })
  const observer = await observerContext.newPage()
  const realtimeConnection = observer.waitForEvent(
    'websocket',
    (websocket) => new URL(websocket.url()).pathname === '/connection/websocket',
  )
  await observer.goto('/')
  await signIn(observer)
  await realtimeConnection

  await page.getByRole('button', { name: 'Add a print' }).click()
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'proxy-realtime.stl', mimeType: 'model/stl', buffer: boxStl('proxy-realtime', 10, 10, 10) })
  await page.getByLabel('Name').fill('Proxy realtime')
  await page.getByRole('button', { name: 'Add 1 print' }).click()

  await expect(observer.locator('button.card').filter({ hasText: 'Proxy realtime' })).toBeVisible()
  await observerContext.close()
})

async function foreignOriginStatus(publicURL: URL) {
  const { stdout: ca } = await execFile('docker', [
    'exec',
    'stlquest-e2e-https-proxy',
    'cat',
    '/tmp/caddy-data/caddy/pki/authorities/local/root.crt',
  ])
  return new Promise<number | undefined>((resolve, reject) => {
    const probe = request(
      {
        hostname: '127.0.0.1',
        port: publicURL.port,
        path: '/connection/websocket',
        servername: publicURL.hostname,
        ca,
        headers: { Host: publicURL.host, Origin: 'https://foreign.example.com' },
      },
      (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      },
    )
    probe.on('error', reject)
    probe.end()
  })
}

async function signIn(page: Page) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'Add a print' })).toBeVisible()
}
