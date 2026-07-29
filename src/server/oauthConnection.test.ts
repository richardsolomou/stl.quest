import { afterEach, describe, expect, it, vi } from 'vitest'
import { exchangeOAuthAuthorizationCode, fetchOAuthProfile } from './oauthConnection'

describe('OAuth connection requests', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('exchanges an authorization code with provider parameters', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ access_token: 'access', refresh_token: 'refresh' }),
    )
    vi.stubGlobal('fetch', fetch)
    await expect(
      exchangeOAuthAuthorizationCode({
        url: 'https://example.com/token',
        provider: 'Example',
        app: { clientId: 'client', clientSecret: 'secret' },
        code: 'code',
        redirectUri: 'https://app.example.com/callback',
        parameters: { scope: 'files' },
      }),
    ).resolves.toEqual({ access_token: 'access', refresh_token: 'refresh' })
    expect(fetch.mock.calls[0][1]?.body).toEqual(
      new URLSearchParams({
        client_id: 'client',
        client_secret: 'secret',
        code: 'code',
        grant_type: 'authorization_code',
        redirect_uri: 'https://app.example.com/callback',
        scope: 'files',
      }),
    )
  })

  it('reports profile lookup failures with provider context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('denied', { status: 403 })),
    )
    await expect(fetchOAuthProfile('https://example.com/me', 'access', 'Example')).rejects.toMatchObject({
      status: 502,
    })
  })

  it('supports HTTP Basic client authentication', async () => {
    let requestInit: RequestInit | undefined
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestInit = init
      return Response.json({ access_token: 'access' })
    })
    vi.stubGlobal('fetch', fetch)
    await exchangeOAuthAuthorizationCode({
      url: 'https://example.com/token',
      provider: 'Example',
      app: { clientId: 'client', clientSecret: 'secret' },
      code: 'code',
      redirectUri: 'https://app.example.com/callback',
      clientAuthentication: 'basic',
    })
    expect(new Headers(requestInit?.headers).get('authorization')).toBe('Basic Y2xpZW50OnNlY3JldA==')
    expect(requestInit?.body).toEqual(
      new URLSearchParams({ code: 'code', grant_type: 'authorization_code', redirect_uri: 'https://app.example.com/callback' }),
    )
  })
})
