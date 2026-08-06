import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'

const execFile = promisify(execFileCallback)
const secondReplica = 'http://127.0.0.1:4274'

test('delivers presence and updates across Redis-backed replicas', async ({ page, browser }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'Set up STL Quest' }).click()
  await page.getByLabel('Name').fill('Distributed Owner')
  await page.getByLabel('Email').fill('distributed-owner@example.com')
  await page.getByLabel('Password').fill('correct-horse-battery-staple')
  await page.getByLabel('Password').press('Enter')
  await page.getByRole('button', { name: 'Use included storage' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('button', { name: 'Add a print' })).toBeVisible()

  const observerContext = await browser.newContext({ baseURL: secondReplica })
  await observerContext.addCookies(await page.context().cookies())
  const observer = await observerContext.newPage()
  const observerSocket = observer.waitForEvent('websocket', isRealtimeSocket)
  await observer.goto('/')
  await observerSocket
  await expect(observer.getByRole('button', { name: 'Add a print' })).toBeVisible()
  await expect(page.getByLabel('1 person viewing this board')).toBeVisible()
  await expect(observer.getByLabel('1 person viewing this board')).toBeVisible()

  await page.goto('/settings/board')
  await observer.goto('/settings/board')
  await changeVisibility(page, 'Private')
  await expect(observer.getByLabel('Request visibility')).toContainText('Private')

  const reconnected = observer.waitForEvent('websocket', isRealtimeSocket)
  await execFile('docker', ['restart', 'stlquest-e2e-distributed-b'])
  await reconnected
  await expect(observer.getByLabel('Request visibility')).toContainText('Private')

  await execFile('docker', ['stop', 'stlquest-e2e-distributed-redis'])
  await changeVisibility(page, 'Shared')
  await expect.poll(boardSetting).toContain('false')
  await execFile('docker', ['start', 'stlquest-e2e-distributed-redis'])
  await expect.poll(redisPing).toBe('PONG')
  await expect(observer.getByLabel('Request visibility')).toContainText('Shared', { timeout: 60_000 })
  await changeVisibility(page, 'Private')
  await expect(observer.getByLabel('Request visibility')).toContainText('Private', { timeout: 60_000 })

  await observerContext.close()
})

function isRealtimeSocket(socket: { url(): string }) {
  return new URL(socket.url()).pathname === '/connection/websocket'
}

async function redisPing() {
  const { stdout } = await execFile('docker', ['exec', 'stlquest-e2e-distributed-redis', 'redis-cli', 'ping'])
  return stdout.trim()
}

async function boardSetting() {
  const { stdout } = await execFile('docker', [
    'exec',
    'stlquest-e2e-distributed-postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'stlquest_realtime_test',
    '-Atc',
    "SELECT value_json FROM settings WHERE key = 'board'",
  ])
  return stdout.trim()
}

async function changeVisibility(page: import('@playwright/test').Page, visibility: 'Private' | 'Shared') {
  await page.getByLabel('Request visibility').click()
  await page.getByRole('option', { name: visibility }).click()
  await expect(page.getByLabel('Request visibility')).toContainText(visibility)
}
