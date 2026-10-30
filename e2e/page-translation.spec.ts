import { expect, test } from './fixtures/test'

test('keeps the page working when browser translation wraps a button label', async ({ page }) => {
  await page.goto('/')
  const setupButton = page.getByRole('button', { name: 'Set up STL Quest' })
  const signInButton = page.getByRole('button', { name: 'Sign in', exact: true })
  await expect(setupButton.or(signInButton)).toBeVisible()
  test.skip(await setupButton.isVisible(), 'Needs the owner account that the journey spec creates')
  await expect(page.locator('form[data-hydrated="true"]')).toBeVisible()

  // What Chrome's page translation does to each text node: wrap it in two <font> elements.
  await signInButton.evaluate((button) => {
    for (const text of [...button.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE)) {
      const outer = document.createElement('font')
      const inner = outer.appendChild(document.createElement('font'))
      button.replaceChild(outer, text)
      inner.appendChild(text)
      text.textContent = 'Přihlásit se'
    }
  })
  await page.getByLabel('Email').fill('owner@example.com')
  await page.getByLabel('Password').fill('not-the-password')

  // Submitting inserts a spinner before the label that translation moved.
  await page.getByRole('button', { name: 'Přihlásit se' }).click()

  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('Something went wrong')).toBeHidden()
})
