import { beforeEach, describe, expect, it, vi } from 'vitest'
import { messagesFor } from '../core/i18n'
import {
  socialProviderTestErrorCode,
  socialProviderTestFailure,
  socialProviderTestResult,
  startSocialProviderTest,
} from './socialProviderTest'

const linkSocial = vi.hoisted(() => vi.fn())
vi.mock('./authClient', () => ({ authClient: { linkSocial } }))

describe('social provider test', () => {
  beforeEach(() => {
    linkSocial.mockReset()
  })

  it('marks both redirect destinations with the tested provider', async () => {
    linkSocial.mockResolvedValue({ error: null })
    await startSocialProviderTest('oidc', 'Test failed')
    expect(linkSocial).toHaveBeenCalledWith({
      provider: 'oidc',
      callbackURL: '/admin/integrations?authTest=oidc',
      errorCallbackURL: '/admin/integrations?authTest=oidc&authTestFailed=true',
    })
  })

  it('surfaces an immediate API error', async () => {
    linkSocial.mockResolvedValue({ error: { message: 'Provider not found' } })
    await expect(startSocialProviderTest('oidc', 'Test failed')).rejects.toThrow('Provider not found')
  })

  it('uses a fallback for an API error without a message', async () => {
    linkSocial.mockResolvedValue({ error: {} })
    await expect(startSocialProviderTest('oidc', 'Test failed')).rejects.toThrow('Test failed')
  })

  it('surfaces network failures', async () => {
    linkSocial.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(startSocialProviderTest('oidc', 'Test failed')).rejects.toThrow('Failed to fetch')
  })

  it.each([
    ['unable_to_link_account', 'linking'],
    ['email_not_found', 'emailMissing'],
    ['email_not_verified', 'emailUnverified'],
    ['account_already_linked_to_different_user', 'alreadyLinked'],
    ['access_denied', 'consent'],
    ['invalid_code', 'expired'],
    ['issuer_mismatch', 'profile'],
    ['oauth_provider_not_found', 'unavailable'],
  ] as const)('explains %s with actionable guidance', (code, key) => {
    const copy = messagesFor('en').settings.signIn.provider
    expect(socialProviderTestFailure(`?authTest=oidc&error=${code}`, 'oidc', copy)).toBe(copy.testErrors[key])
    expect(socialProviderTestErrorCode(`?authTest=oidc&error=${code}`, 'oidc')).toBe(code)
  })

  it('uses a safe fallback for unknown errors without displaying provider descriptions', () => {
    const copy = messagesFor('en').settings.signIn.provider
    expect(socialProviderTestFailure('?authTest=oidc&error=unexpected&error_description=secret', 'oidc', copy)).toBe(copy.testFailed)
    expect(socialProviderTestErrorCode('?authTest=google&error=access_denied', 'oidc')).toBeUndefined()
    expect(socialProviderTestErrorCode('?authTest=oidc&error=not%20an%20error%20code', 'oidc')).toBeUndefined()
  })

  it('only displays callback feedback on the tested provider', () => {
    expect(socialProviderTestResult('?authTest=oidc', 'oidc')).toBe('returned')
    expect(socialProviderTestResult('?authTest=oidc&authTestFailed=true', 'oidc')).toBe('failed')
    expect(socialProviderTestResult('?authTest=oidc&error=access_denied', 'oidc')).toBe('failed')
    expect(socialProviderTestResult('?authTest=google&authTestFailed=true', 'oidc')).toBeUndefined()
    expect(socialProviderTestResult('', 'oidc')).toBeUndefined()
  })
})
