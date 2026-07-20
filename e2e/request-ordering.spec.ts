import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { boxStl } from './fixtures/stl'

const password = 'correct-horse-battery-staple'
const captureScreenshots = process.env.CAPTURE_E2E_SCREENSHOTS === '1'

test('requesters own queue priority while admins move work between stages', async ({ page, browser }) => {
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
  const requesterSort = requesterPage.getByRole('button', { name: 'Sort requests: My priority' })
  await expect(requesterSort).toContainText('My priority')
  await requesterSort.click()
  await expect(requesterPage.getByRole('menuitemradio', { name: 'Round robin' })).toHaveCount(0)
  await requesterPage.keyboard.press('Escape')
  await requesterPage.goto('/?sort=round-robin')
  await expect(requesterPage.getByRole('button', { name: 'Sort requests: My priority' })).toBeVisible()
  await expect(requestCard(requesterPage, 'requester-first')).toBeVisible()
  await screenshot(requesterPage, 'requester-my-priority-desktop')
  await expect(requestCard(requesterPage, 'requester-second')).toHaveAttribute('data-draggable', 'true')
  await openQueueActions(requesterPage, 'requester-second')
  await requesterPage.getByRole('menuitem', { name: 'Later' }).press('Enter')
  await expect
    .poll(async () => (await todoCardNames(requesterPage)).filter((name) => name.startsWith('requester-')))
    .toEqual(['requester-first', 'requester-second'])
  await openQueueActions(requesterPage, 'requester-second')
  await requesterPage.getByRole('menuitem', { name: 'Earlier' }).press('Enter')
  await expect
    .poll(async () => (await todoCardNames(requesterPage)).filter((name) => name.startsWith('requester-')))
    .toEqual(['requester-second', 'requester-first'])
  await requesterContext.close()

  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Board', exact: true }).click()
  await expect(requestCard(page, 'requester-first')).toBeVisible({ timeout: 30_000 })
  await expect(requestCard(page, 'requester-second')).toBeVisible()
  await expect(requestCard(page, 'admin-first')).toContainText('For Owner')
  await expect(requestCard(page, 'requester-first')).toContainText('For Queue Requester')

  const requesterOrder = ['requester-second', 'requester-first']
  const ownerOrder = await todoCardNamesFor(page, 'For Owner')
  const priorityOrder = [...ownerOrder, ...requesterOrder]
  await expect(page.getByRole('button', { name: 'Sort requests: Requester priorities' })).toContainText('Requester priorities')
  await expect.poll(() => todoCardNames(page)).toEqual(priorityOrder)

  await page.getByRole('button', { name: 'Sort requests: Requester priorities' }).click()
  await page.getByRole('menuitemradio', { name: 'Round robin' }).click()
  const roundRobinOrder = Array.from({ length: Math.max(ownerOrder.length, requesterOrder.length) }, (_, index) => [
    ownerOrder[index],
    requesterOrder[index],
  ])
    .flat()
    .filter((name): name is string => !!name)
  await expect.poll(() => todoCardNames(page)).toEqual(roundRobinOrder)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sort requests: Round robin' })).toBeVisible()
  await expect.poll(() => todoCardNames(page)).toEqual(roundRobinOrder)
  await dragCardOnto(page, ownerOrder[0], ownerOrder[1])
  await expect.poll(() => todoCardNames(page)).toEqual(roundRobinOrder)
  await screenshot(page, 'owner-round-robin-desktop')

  await page.getByRole('button', { name: 'Sort requests: Round robin' }).click()
  await page.getByRole('menuitemradio', { name: 'Requester priorities' }).click()
  await expect.poll(() => todoCardNames(page)).toEqual(priorityOrder)
  await expect.poll(async () => (await todoCardNames(page)).filter((name) => name.startsWith('requester-'))).toEqual(requesterOrder)
  await dragCardOnto(page, 'requester-first', 'admin-first')
  await expect.poll(async () => (await todoCardNames(page)).filter((name) => name.startsWith('requester-'))).toEqual(requesterOrder)

  await dragCardOnto(page, 'requester-first', 'requester-second')
  await expect.poll(async () => (await todoCardNames(page)).filter((name) => name.startsWith('requester-'))).toEqual(requesterOrder)

  await openQueueActions(page, 'admin-first')
  await page.getByRole('menuitem', { name: 'Move to…' }).press('Enter')
  await page.getByLabel('Destination').press('Enter')
  await page.getByRole('option', { name: 'Printing' }).press('Enter')
  await page.getByRole('button', { name: 'Move', exact: true }).press('Enter')
  await expect(requestCardInColumn(page, 'admin-first', 'in_progress')).toBeVisible()
  await dragCardToColumn(page, 'requester-first', 'in_progress')
  await dragCardToColumn(page, 'requester-second', 'in_progress')
  await expect(requestCardInColumn(page, 'requester-first', 'in_progress')).toBeVisible()
  await expect(requestCardInColumn(page, 'requester-first', 'todo')).toHaveCount(0)
  await expect.poll(() => cardNamesFor(page, 'in_progress', 'For Queue Requester')).toEqual(requesterOrder)

  await screenshot(page, 'requester-owned-priority-desktop')
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
  const printerName = page.getByLabel('Printer name').first()
  if (!(await printerName.count())) {
    await page.getByRole('button', { name: 'Add printer' }).click()
    await page.getByRole('button', { name: 'Custom printer' }).click()
  }
  await page.getByLabel('Printer name').first().fill('Resin printer')
  await page.getByRole('button', { name: 'Save and continue' }).click()
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

function queueActions(page: Page, name: string) {
  return page.getByLabel(`Queue actions for ${name}`)
}

async function openQueueActions(page: Page, name: string) {
  await queueActions(page, name).focus()
  await page.keyboard.press('ArrowDown')
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
  await page.waitForTimeout(100)
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 12, { steps: 12 })
  await page.waitForTimeout(100)
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

async function todoCardNamesFor(page: Page, text: string) {
  return cardNamesFor(page, 'todo', text)
}

async function cardNamesFor(page: Page, status: string, text: string) {
  return page
    .locator(`[data-status="${status}"] button.card`)
    .filter({ hasText: text })
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-request-name') ?? ''))
}

async function screenshot(page: Page, name: string) {
  if (!captureScreenshots) return
  await page.waitForTimeout(400)
  await page.locator('[data-status="todo"] .column-body').evaluate((element) => element.scrollTo({ top: 0 }))
  const screenshotDirectory = path.join(process.cwd(), 'test-results/manual-inspection')
  await fs.mkdir(screenshotDirectory, { recursive: true })
  await page.screenshot({ path: path.join(screenshotDirectory, `${name}.png`), fullPage: true })
}
