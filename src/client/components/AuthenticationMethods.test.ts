import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AuthScreen } from './AuthScreen'
import { AuthenticationMethods } from './AuthenticationMethods'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({}),
  useLocation: ({ select }: { select: (location: { searchStr: string }) => unknown }) =>
    select({ searchStr: '?error=signup_disabled&error_description=private-provider-details' }),
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
  useQuery: (options: { initialData: unknown }) => ({ data: options.initialData }),
}))
vi.mock('../queries', () => ({ authCapabilitiesQuery: () => ({}) }))
vi.mock('./Brand', () => ({ AuthBrand: () => null }))
vi.mock('@posthog/react', () => ({ usePostHog: () => ({}) }))

describe('social sign-in failure feedback', () => {
  it('shows the callback failure instead of the setup introduction on a first-account attempt', () => {
    const html = renderToStaticMarkup(
      createElement(AuthScreen, {
        auth: { password: false, passwordReset: false, socialProviders: ['oidc'], selfSignup: true },
        setupRequired: true,
        hosted: false,
      }),
    )
    expect(html).toContain('Could not complete sign-in. Try again or contact your administrator.')
    expect(html).not.toContain('Set up STL Quest')
    expect(html).toContain('Continue with SSO')
  })

  it.each([false, true])('shows only generic callback feedback with password authentication %s', (password) => {
    const html = renderToStaticMarkup(
      createElement(AuthenticationMethods, {
        auth: { password, passwordReset: false, socialProviders: ['oidc'], selfSignup: true },
        hydrated: true,
        initialAdmin: false,
        setupRequired: false,
        signingUp: false,
        creatingAccount: false,
        setCreatingAccount: () => {},
      }),
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('Could not complete sign-in. Try again or contact your administrator.')
    expect(html).toContain('<code>signup_disabled</code>')
    expect(html).not.toContain('private-provider-details')
  })
})
