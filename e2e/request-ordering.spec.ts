import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { boxStl } from './fixtures/stl'

const password = 'correct-horse-battery-staple'

test('admin reorders personal queues without changing another requester priority', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Set up PrintHub' }).click()
  await page.getByLabel('Name').fill('Owner')
  await page.getByLabel('Email').fill('owner@example.com')
  await page.getByLabel('Password').fill(password)
  await page.getByLabel('Password').press('Enter')
  await page.getByRole('button', { name: 'Finish setup' }).click()
  await page.getByRole('button', { name: 'Add printer' }).click()
  const printer = page.getByRole('region', { name: 'Printer 1' })
  await printer.getByLabel('Printer name').fill('Resin printer')
  await printer.getByLabel('Usable width').fill('130')
  await printer.getByLabel('Usable depth').fill('80')
  await printer.getByLabel('Usable height').fill('160')
  await page.getByRole('button', { name: 'Save printers and finish' }).click()

  await upload(page, 'admin-first', 8)
  await upload(page, 'admin-second', 9)
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('link', { name: 'Members' }).click()
  await page.getByRole('button', { name: 'Invite user' }).click()
  await page.getByRole('button', { name: 'Create invite link' }).click()
  const inviteUrl = await page.locator('#invite-link').inputValue()

  const requesterContext = await browser.newContext()
  const requesterPage = await requesterContext.newPage()
  await requesterPage.goto(inviteUrl)
  await requesterPage.getByLabel('Name').fill('Requester')
  await requesterPage.getByLabel('Email').fill('requester@example.com')
  await requesterPage.getByLabel('Password').fill(password)
  await requesterPage.getByRole('button', { name: 'Create account' }).click()
  await upload(requesterPage, 'requester-first', 10)
  await upload(requesterPage, 'requester-second', 11)
  await requesterContext.close()

  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Board', exact: true }).click()
  await expect(requestCard(page, 'requester-first')).toBeVisible({ timeout: 30_000 })
  await expect(requestCard(page, 'requester-second')).toBeVisible()

  const requesterOrder = (await todoCardNames(page)).filter((name) => name.startsWith('requester-'))
  await dragCardOnto(page, 'requester-first', 'admin-first')
  await expect.poll(async () => (await todoCardNames(page)).filter((name) => name.startsWith('requester-'))).toEqual(requesterOrder)

  const adminOrder = (await todoCardNames(page)).filter((name) => name.startsWith('admin-'))
  await dragCardOnto(page, 'requester-first', 'requester-second')
  await expect
    .poll(async () => (await todoCardNames(page)).filter((name) => name.startsWith('requester-')))
    .toEqual(['requester-first', 'requester-second'])
  await expect.poll(async () => (await todoCardNames(page)).filter((name) => name.startsWith('admin-'))).toEqual(adminOrder)

  await page.locator('[data-status="todo"] .column-body').evaluate((element) => element.scrollTo({ top: 0 }))
  await page.waitForTimeout(300)
  const screenshotDirectory = path.join(process.cwd(), 'test-results/manual-inspection')
  await fs.mkdir(screenshotDirectory, { recursive: true })
  await page.screenshot({ path: path.join(screenshotDirectory, 'admin-requester-queue-reorder-desktop.png'), fullPage: true })
})

async function upload(page: Page, name: string, size: number) {
  await page.getByRole('button', { name: 'Add a print' }).click()
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: `${name}.stl`, mimeType: 'model/stl', buffer: boxStl(name, size, size, size) })
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Add 1 print' }).click()
  await expect(requestCard(page, name)).toBeVisible({ timeout: 30_000 })
}

function requestCard(page: Page, name: string) {
  return page.locator('button.card').filter({ hasText: name })
}

async function dragCardOnto(page: Page, sourceName: string, targetName: string) {
  const [sourceBox, targetBox] = await Promise.all([
    requestCard(page, sourceName).boundingBox(),
    requestCard(page, targetName).boundingBox(),
  ])
  expect(sourceBox).not.toBeNull()
  expect(targetBox).not.toBeNull()
  await page.mouse.move(sourceBox!.x + 32, sourceBox!.y + 32)
  await page.mouse.down()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 12, { steps: 12 })
  await page.mouse.up()
}

async function todoCardNames(page: Page) {
  return page
    .locator('[data-status="todo"] button.card')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-request-name') ?? ''))
}
