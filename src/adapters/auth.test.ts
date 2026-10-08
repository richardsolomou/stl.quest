import { describe, expect, it } from 'vitest'
import { resolveAuthAdapterConfig } from './auth'

describe('auth adapter configuration', () => {
  it('defaults to password authentication', () => {
    expect(resolveAuthAdapterConfig(undefined, {})).toEqual({
      password: true,
      passwordReset: true,
      socialProviders: [],
    })
  })

  it('enables configured social providers', () => {
    expect(
      resolveAuthAdapterConfig(undefined, {
        AUTH_PASSWORD_ENABLED: 'false',
        AUTH_GOOGLE_CLIENT_ID: 'google-id',
        AUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
      }),
    ).toMatchObject({ password: false, socialProviders: ['google'], google: { clientId: 'google-id', clientSecret: 'google-secret' } })
  })

  it('rejects incomplete or empty authentication configuration', () => {
    expect(() => resolveAuthAdapterConfig(undefined, { AUTH_GOOGLE_CLIENT_ID: 'google-id' })).toThrow(/configured together/)
    expect(() => resolveAuthAdapterConfig(undefined, { AUTH_PASSWORD_ENABLED: 'false' })).toThrow(/at least one social provider/)
  })

  it('configures OpenID Connect from the environment', () => {
    expect(
      resolveAuthAdapterConfig(undefined, {
        AUTH_OIDC_ISSUER: 'https://auth.example.com/application/o/stlquest/',
        AUTH_OIDC_CLIENT_ID: 'oidc-id',
        AUTH_OIDC_CLIENT_SECRET: 'oidc-secret',
        AUTH_OIDC_NAME: 'Authentik',
      }),
    ).toMatchObject({
      socialProviders: ['oidc'],
      oidcName: 'Authentik',
      oidc: {
        enabled: true,
        clientId: 'oidc-id',
        issuer: 'https://auth.example.com/application/o/stlquest',
        scopes: ['openid', 'email', 'profile'],
        name: 'Authentik',
      },
    })
    expect(() => resolveAuthAdapterConfig(undefined, { AUTH_OIDC_CLIENT_ID: 'oidc-id', AUTH_OIDC_CLIENT_SECRET: 'oidc-secret' })).toThrow(
      /AUTH_OIDC_ISSUER/,
    )
  })

  it('uses database settings unless environment variables override them', () => {
    const stored = {
      passwordEnabled: false,
      google: { enabled: true, clientId: 'stored-id', clientSecret: 'stored-secret' },
    }
    expect(resolveAuthAdapterConfig(stored, {})).toMatchObject({ password: false, google: stored.google })
    expect(resolveAuthAdapterConfig(stored, { AUTH_PASSWORD_RECOVERY: 'true' })).toMatchObject({ password: true })
  })
})
