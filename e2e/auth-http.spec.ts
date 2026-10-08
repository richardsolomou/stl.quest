import { expect, test } from '@playwright/test'

test('signs in over direct self-hosted HTTP', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Set up STL Quest' }).click()
  await page.getByLabel('Name').fill('Owner')
  await page.getByLabel('Email').fill('owner@example.com')
  await page.getByLabel('Password').fill('correct-horse-battery-staple')
  await page.getByRole('button', { name: 'Create super admin' }).click()
  await expect(page.getByRole('heading', { name: 'Choose where your models live' })).toBeVisible()

  await page.context().clearCookies()
  await page.reload()
  await page.getByLabel('Email').fill('owner@example.com')
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible()

  await page.getByLabel('Password').fill('correct-horse-battery-staple')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Choose where your models live' })).toBeVisible()

  await page.goto('/admin/users')
  const selfSignup = page.getByRole('switch', { name: 'Allow self-signup' })
  await expect(selfSignup).toBeChecked()
  await selfSignup.click()
  await expect(selfSignup).not.toBeChecked()
  await page.getByRole('button', { name: 'Add user' }).click()
  const createUserDialog = page.getByRole('dialog', { name: 'Create user' })
  await createUserDialog.getByLabel('Name').fill('Requester')
  await createUserDialog.getByLabel('Email').fill('requester@example.com')
  await createUserDialog.getByLabel('Password').fill('requester-password')
  await page.getByRole('button', { name: 'Create user' }).click()

  await page.getByRole('button', { name: 'Add user' }).click()
  await createUserDialog.getByLabel('Name').fill('Leaver')
  await createUserDialog.getByLabel('Email').fill('leaver@example.com')
  await createUserDialog.getByLabel('Password').fill('leaver-password')
  await page.getByRole('button', { name: 'Create user' }).click()
  await page.getByRole('button', { name: 'Actions for Leaver' }).click()
  await page.getByRole('button', { name: 'Delete user' }).click()
  await page.getByRole('alertdialog', { name: 'Delete user' }).getByRole('button', { name: 'Delete user' }).click()
  await expect(page.getByText('Leaver was deleted')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Actions for Leaver' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Actions for Requester' }).click()
  await page.getByRole('button', { name: 'View as user' }).click()
  await page.getByRole('button', { name: 'View as Requester' }).click()

  await expect(page.getByText('Viewing as Requester')).toBeVisible()
  if (process.env.CAPTURE_E2E_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/auth-http-success.png', fullPage: true })

  await page.context().clearCookies()
  await page.goto('/?signup=true')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Create an account/ })).toHaveCount(0)
})
