import { afterEach, describe, expect, it, vi } from 'vitest'
import { OAuthAccessTokenCache } from './oauthAccessToken'

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
