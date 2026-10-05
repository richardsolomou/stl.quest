import { describe, expect, it } from 'vitest'
import {
  normalizeOidcIssuer,
  oidcDiscoveryUrl,
  oidcDisplayName,
  parseOidcScopes,
  signInFailureMessage,
  signInFailureReason,
  socialProviderName,
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

describe('signInFailureMessage', () => {
  it('tells a rate-limited user to wait rather than that their password is wrong', () => {
    expect(signInFailureMessage({ status: 429 })).toBe('Too many sign-in attempts. Wait a minute, then try again.')
  })

  it('keeps the credential message for a real 401', () => {
    expect(signInFailureMessage({ status: 401 })).toBe('Email or password is incorrect.')
  })

  it('surfaces the server message for other failures instead of a wrong-password lie', () => {
    expect(signInFailureMessage({ status: 503, message: 'Service unavailable.' })).toBe('Service unavailable.')
    expect(signInFailureMessage({ status: 500 })).toBe('Something went wrong signing in. Try again.')
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
})
