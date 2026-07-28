import { expect, test } from '@playwright/test'

test('starts a hosted workspace with included managed storage and guides an ineligible second workspace to BYO storage', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Set up STL Quest' }).click()
  await page.getByLabel('Name').fill('Hosted Owner')
  await page.getByLabel('Email').fill('hosted-owner@example.com')
  await page.getByLabel('Password').fill('correct-horse-battery-staple')
  await page.getByLabel('Password').press('Enter')

  await expect(page.getByText('STL Quest managed storage')).toBeVisible()
  await expect(page.getByText('1 GB for models, previews, and thumbnails')).toBeVisible()
  await page.getByRole('button', { name: 'Use included storage' }).click()
  await expect(page.getByRole('heading', { name: 'Add the printers you own' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('link', { name: '1.0 GB storage available' })).toBeVisible()

  await page.goto('/settings/storage')
  await expect(page.getByText('0 B used or reserved')).toBeVisible()
  await expect(page.getByText('1.0 GB available')).toBeVisible()

  await page.getByRole('button', { name: 'Open account menu' }).click()
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await page.getByLabel('Workspace name').fill('BYO workspace')
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(page.getByText('BYO workspace', { exact: true })).toBeVisible()
  await page.goto('/')

  await expect(page.getByText('Your included storage is already assigned to another workspace.')).toBeVisible()
  await expect(page.getByText('Connect S3, WebDAV, or a cloud account for this workspace instead.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use included storage' })).toHaveCount(0)
  await expect(page.getByText('S3-compatible bucket')).toBeVisible()
})
