import { describe, expect, it } from 'vitest'
import { messagesFor } from './i18n'
import {
  authErrorMessage,
  linkedAccountActive,
  normalizeOidcIssuer,
  oidcDiscoveryUrl,
  oidcDisplayName,
  oidcIssuerMatches,
  parseOidcScopes,
  signInFailureMessage,
  signInFailureReason,
  socialProviderName,
  socialProviderNeedsRetest,
} from './auth'

describe('signInFailureReason', () => {
  it('classifies the rate limiter (429) so retries are not blamed on the password', () => {
    expect(signInFailureReason({ status: 429 })).toBe('rate_limited')
    expect(signInFailureReason({ status: 429, code: 'INVALID_EMAIL_OR_PASSWORD' })).toBe('rate_limited')
  })

  it('classifies genuinely bad credentials', () => {
    expect(signInFailureReason({ status: 401 })).toBe('invalid_credentials')
    expect(signInFailureReason({ code: 'INVALID_EMAIL_OR_PASSWORD' })).toBe('invalid_credentials')
  })

  it('classifies transport and server faults as an unexpected error', () => {
    expect(signInFailureReason({ status: 500 })).toBe('error')
    expect(signInFailureReason({})).toBe('error')
    expect(signInFailureReason(null)).toBe('error')
    expect(signInFailureReason(undefined)).toBe('error')
  })
})

const en = messagesFor('en').auth
const fr = messagesFor('fr').auth

describe('authErrorMessage', () => {
  it('translates a known Better Auth code', () => {
    expect(authErrorMessage(fr, { code: 'USER_ALREADY_EXISTS', message: 'User already exists.' }, 'x')).toBe(fr.errors.USER_ALREADY_EXISTS)
  })

  it('keeps Better Auth wording in English', () => {
    expect(authErrorMessage(en, { code: 'USER_ALREADY_EXISTS', message: 'User already exists.' }, 'x')).toBe('User already exists.')
  })

  it('falls back to the server message for an unknown code', () => {
    expect(authErrorMessage(fr, { code: 'SOMETHING_NEW', message: 'Server says no' }, 'x')).toBe('Server says no')
  })

  it('falls back to the fallback without a message', () => {
    expect(authErrorMessage(fr, {}, 'fallback')).toBe('fallback')
  })
})

describe('signInFailureMessage', () => {
  it('translates the credential message', () => {
    expect(signInFailureMessage(fr, { status: 401 })).toBe('E-mail ou mot de passe incorrect.')
  })

  it('tells a rate-limited user to wait rather than that their password is wrong', () => {
    expect(signInFailureMessage(en, { status: 429 })).toBe('Too many sign-in attempts. Wait a minute, then try again.')
  })

  it('keeps the credential message for a real 401', () => {
    expect(signInFailureMessage(en, { status: 401 })).toBe('Email or password is incorrect.')
  })

  it('surfaces the server message for other failures instead of a wrong-password lie', () => {
    expect(signInFailureMessage(en, { status: 503, message: 'Service unavailable.' })).toBe('Service unavailable.')
    expect(signInFailureMessage(en, { status: 500 })).toBe('Something went wrong signing in. Try again.')
  })
})

describe('OpenID Connect settings', () => {
  it('normalizes issuer and discovery URLs to one issuer', () => {
    expect(normalizeOidcIssuer(' https://auth.example.com/application/o/stlquest/ ')).toBe(
      'https://auth.example.com/application/o/stlquest',
    )
    expect(normalizeOidcIssuer('https://auth.example.com/realms/main/.well-known/openid-configuration')).toBe(
      'https://auth.example.com/realms/main',
    )
    expect(normalizeOidcIssuer('http://idp.lan:9000')).toBe('http://idp.lan:9000')
    expect(oidcDiscoveryUrl('https://auth.example.com/realms/main')).toBe(
      'https://auth.example.com/realms/main/.well-known/openid-configuration',
    )
  })

  it.each([
    ['the identical issuer', 'https://auth.example.com/realms/main', true],
    ['the issuer with a terminating slash', 'https://auth.example.com/realms/main/', true],
    ['another host', 'https://evil.example.com/realms/main', false],
    ['a parent path', 'https://auth.example.com/realms', false],
    ['repeated terminating slashes', 'https://auth.example.com/realms/main//', false],
    ['a missing issuer', undefined, false],
  ])('matches a discovered issuer against the configured one: %s', (_name, discovered, expected) => {
    expect(oidcIssuerMatches('https://auth.example.com/realms/main', discovered)).toBe(expected)
  })

  it('rejects issuers that are not plain http or https URLs', () => {
    expect(normalizeOidcIssuer('auth.example.com')).toBeUndefined()
    expect(normalizeOidcIssuer('javascript:alert(1)')).toBeUndefined()
    expect(normalizeOidcIssuer('https://user:pass@auth.example.com')).toBeUndefined()
    expect(normalizeOidcIssuer('https://auth.example.com/?tenant=1')).toBeUndefined()
  })

  it('always requests the openid scope', () => {
    expect(parseOidcScopes(undefined)).toEqual(['openid', 'email', 'profile'])
    expect(parseOidcScopes('email, groups  email')).toEqual(['openid', 'email', 'groups'])
  })

  it('uses the configured button label for the OIDC provider only', () => {
    expect(oidcDisplayName('  ')).toBe('SSO')
    expect(socialProviderName('oidc', 'Authentik')).toBe('Authentik')
    expect(socialProviderName('oidc')).toBe('SSO')
    expect(socialProviderName('google', 'Authentik')).toBe('Google')
  })

  it('counts an OIDC link only under the issuer that created it', () => {
    const link = { providerId: 'oidc', accountId: 'https://auth.example.com/realms/main#42' }

    expect(linkedAccountActive(link, 'https://auth.example.com/realms/main')).toBe(true)
    expect(linkedAccountActive(link, 'https://auth.example.com/realms/mai')).toBe(false)
    expect(linkedAccountActive(link, undefined)).toBe(false)
    expect(linkedAccountActive({ providerId: 'google', accountId: '42' }, undefined)).toBe(true)
  })
})

describe('social provider retesting', () => {
  const current = {
    enabled: true,
    clientId: 'id',
    clientSecret: 'secret',
    issuer: 'https://id.example.com',
    scopes: ['openid', 'email'],
    name: 'SSO',
    allowSignup: true,
  }
  it('keeps a tested provider enabled when only account creation changes', () => {
    expect(socialProviderNeedsRetest(current, { ...current, clientSecret: '' })).toBe(false)
  })
  it('requires testing new credentials, issuer, or scopes', () => {
    expect(socialProviderNeedsRetest(current, { ...current, clientSecret: 'replacement' })).toBe(true)
    expect(socialProviderNeedsRetest(current, { ...current, issuer: 'https://other.example.com' })).toBe(true)
    expect(socialProviderNeedsRetest(current, { ...current, scopes: ['openid'] })).toBe(true)
  })
})
