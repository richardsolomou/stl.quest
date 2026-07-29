import { afterEach, describe, expect, it, vi } from 'vitest'
import { OAuthAccessTokenCache, refreshOAuthAccessToken } from './oauthAccessToken'

describe('OAuthAccessTokenCache', () => {
  afterEach(() => vi.useRealTimers())

  it('shares one refresh across concurrent callers', async () => {
    const cache = new OAuthAccessTokenCache()
    const refresh = vi.fn(async () => ({ value: 'token', expiresInSeconds: 3_600 }))
    expect(await Promise.all([cache.get(refresh), cache.get(refresh)])).toEqual(['token', 'token'])
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('refreshes after the safety-window expiry', async () => {
    vi.useFakeTimers()
    const cache = new OAuthAccessTokenCache()
    const refresh = vi.fn(async () => ({ value: `token-${refresh.mock.calls.length}`, expiresInSeconds: 61 }))
    expect(await cache.get(refresh)).toBe('token-1')
    await vi.advanceTimersByTimeAsync(1_001)
    expect(await cache.get(refresh)).toBe('token-2')
  })
})

describe('refreshOAuthAccessToken', () => {
  it('posts form parameters and decodes rotated tokens', async () => {
    const fetch = vi.fn(async () => Response.json({ access_token: 'access-token', expires_in: 3_600, refresh_token: 'rotated-token' }))
    await expect(
      refreshOAuthAccessToken('https://example.com/token', {
        parameters: { grant_type: 'refresh_token', refresh_token: 'refresh-token' },
        headers: { authorization: 'Basic credentials' },
        fetch,
        error: vi.fn(),
      }),
    ).resolves.toEqual({ value: 'access-token', expiresInSeconds: 3_600, refreshToken: 'rotated-token' })
    expect(fetch).toHaveBeenCalledWith('https://example.com/token', {
      method: 'POST',
      headers: { authorization: 'Basic credentials', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'refresh-token' }),
    })
  })

  it('uses the provider error decoder for failed refreshes', async () => {
    const failure = new Error('provider failure')
    const response = new Response('failed', { status: 400 })
    const error = vi.fn(async () => failure)
    await expect(
      refreshOAuthAccessToken('https://example.com/token', {
        parameters: {},
        fetch: vi.fn(async () => response),
        error,
      }),
    ).rejects.toBe(failure)
    expect(error).toHaveBeenCalledWith(response)
  })
})
