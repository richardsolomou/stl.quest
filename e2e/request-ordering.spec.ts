import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { boxStl } from './fixtures/stl'

const password = 'correct-horse-battery-staple'
const captureScreenshots = process.env.CAPTURE_E2E_SCREENSHOTS === '1'

test('admin reorders personal queues without changing another requester priority', async ({ page, browser }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await enterAdminWorkspace(page)

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
  await expect(requesterPage.locator('form[data-hydrated="true"]')).toBeVisible()
  await requesterPage.getByLabel('Name').fill('Queue Requester')
  await requesterPage.getByLabel('Email').fill('queue-requester@example.com')
  await requesterPage.getByLabel('Password').fill(password)
  await requesterPage.getByRole('button', { name: 'Create account' }).click()
  await upload(requesterPage, 'requester-first', 10)
  await upload(requesterPage, 'requester-second', 11)
  await requesterContext.close()

  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Board', exact: true }).click()
  await expect(requestCard(page, 'requester-first')).toBeVisible({ timeout: 30_000 })
  await expect(requestCard(page, 'requester-second')).toBeVisible()
  await expect(requestCard(page, 'admin-first')).toContainText('For Owner')
  await expect(requestCard(page, 'requester-first')).toContainText('For Queue Requester')

  const requesterOrder = (await todoCardNames(page)).filter((name) => name.startsWith('requester-'))
  await dragCardOnto(page, 'requester-first', 'admin-first')
  await expect.poll(async () => (await todoCardNames(page)).filter((name) => name.startsWith('requester-'))).toEqual(requesterOrder)

  await dragCardToColumn(page, 'admin-first', 'in_progress')
  await expect(requestCardInColumn(page, 'admin-first', 'in_progress')).toBeVisible()
  await dragCardOnto(page, 'requester-first', 'admin-first')
  await expect(requestCardInColumn(page, 'requester-first', 'todo')).toBeVisible()
  await expect(requestCardInColumn(page, 'requester-first', 'in_progress')).toHaveCount(0)

  const adminOrder = (await todoCardNames(page)).filter((name) => name.startsWith('admin-'))
  await dragCardOnto(page, 'requester-first', 'requester-second')
  await expect
    .poll(async () => (await todoCardNames(page)).filter((name) => name.startsWith('requester-')))
    .toEqual(['requester-first', 'requester-second'])
  await expect.poll(async () => (await todoCardNames(page)).filter((name) => name.startsWith('admin-'))).toEqual(adminOrder)

  if (captureScreenshots) {
    await page.locator('[data-status="todo"] .column-body').evaluate((element) => element.scrollTo({ top: 0 }))
    const screenshotDirectory = path.join(process.cwd(), 'test-results/manual-inspection')
    await fs.mkdir(screenshotDirectory, { recursive: true })
    await page.screenshot({ path: path.join(screenshotDirectory, 'admin-requester-queue-reorder-desktop.png'), fullPage: true })
  }
})

async function enterAdminWorkspace(page: Page) {
  await page.goto('/')
  const setupButton = page.getByRole('button', { name: 'Set up PrintHub' })
  const signInButton = page.getByRole('button', { name: 'Sign in', exact: true })
  await expect(setupButton.or(signInButton)).toBeVisible()
  if (await signInButton.isVisible()) {
    await page.getByLabel('Email').fill('owner@example.com')
    await page.getByLabel('Password').fill(password)
    await signInButton.click()
    await expect(page.getByRole('button', { name: 'Add a print' })).toBeVisible()
    return
  }

  await setupButton.click()
  await page.getByLabel('Name').fill('Owner')
  await page.getByLabel('Email').fill('owner@example.com')
  await page.getByLabel('Password').fill(password)
  await page.getByLabel('Password').press('Enter')
  await page.getByRole('button', { name: 'Finish setup' }).click()
  await page.getByRole('button', { name: 'Add printer' }).click()
  await page.getByRole('button', { name: 'Custom printer' }).click()
  const printer = page.getByRole('region', { name: 'Printer 1' })
  await printer.getByLabel('Printer name').fill('Resin printer')
  await printer.getByLabel('Usable width').fill('130')
  await printer.getByLabel('Usable depth').fill('80')
  await printer.getByLabel('Usable height').fill('160')
  await page.getByRole('button', { name: 'Save printers and finish' }).click()
}

async function upload(page: Page, name: string, size: number) {
  const fileInput = page.locator('input[type=file]')
  await expect(async () => {
    await page.getByRole('button', { name: 'Add a print' }).click()
    await expect(fileInput).toBeVisible({ timeout: 1_000 })
  }).toPass()
  await fileInput.setInputFiles({ name: `${name}.stl`, mimeType: 'model/stl', buffer: boxStl(name, size, size, size) })
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Add 1 print' }).click()
  await expect(requestCard(page, name)).toBeVisible({ timeout: 30_000 })
}

function requestCard(page: Page, name: string) {
  return page.locator(`button.card[data-request-name="${name}"]`)
}

function requestCardInColumn(page: Page, name: string, status: string) {
  return page.locator(`[data-status="${status}"] button.card[data-request-name="${name}"]`)
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

async function dragCardToColumn(page: Page, sourceName: string, status: string) {
  const [sourceBox, targetBox] = await Promise.all([
    requestCard(page, sourceName).boundingBox(),
    page.locator(`[data-status="${status}"] .column-body`).boundingBox(),
  ])
  expect(sourceBox).not.toBeNull()
  expect(targetBox).not.toBeNull()
  await page.mouse.move(sourceBox!.x + 32, sourceBox!.y + 32)
  await page.mouse.down()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 })
  await page.mouse.up()
}

async function todoCardNames(page: Page) {
  return page
    .locator('[data-status="todo"] button.card')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-request-name') ?? ''))
}
