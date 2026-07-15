import { afterEach, describe, expect, it, vi } from 'vitest'
import { OneDriveAssetStore } from './oneDrive'

const connection = { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'refresh-token' }

describe('OneDriveAssetStore', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uploads streams through an upload session', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'access-token', expires_in: 3_600 }))
      .mockResolvedValueOnce(Response.json({ id: 'root-id', name: 'PrintHub', folder: {} }))
      .mockResolvedValueOnce(Response.json({ id: 'todo-id', name: 'todo', folder: {} }))
      .mockResolvedValueOnce(Response.json({ uploadUrl: 'https://upload.example/session' }))
      .mockResolvedValueOnce(Response.json({ id: 'file-id', size: 5 }))
    vi.stubGlobal('fetch', fetch)
    const store = new OneDriveAssetStore('', connection)

    await store.writeStream('todo/model.stl', new Blob(['model']).stream(), 5)

    expect(fetch.mock.calls[4][0]).toBe('https://upload.example/session')
    expect(new Headers(fetch.mock.calls[4][1]?.headers).get('content-range')).toBe('bytes 0-4/5')
  })

  it('persists rotated refresh tokens', async () => {
    const updateRefreshToken = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: 'access-token', expires_in: 3_600, refresh_token: 'rotated-token' }))
        .mockResolvedValueOnce(Response.json({ id: 'file-id', name: 'model.stl', size: 5 })),
    )
    const store = new OneDriveAssetStore('', { ...connection }, updateRefreshToken)

    await expect(store.stat('model.stl')).resolves.toEqual({ size: 5 })
    expect(updateRefreshToken).toHaveBeenCalledWith('rotated-token')
  })

  it('returns missing files as absent assets', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: 'access-token', expires_in: 3_600 }))
        .mockResolvedValueOnce(Response.json({ error: { code: 'itemNotFound' } }, { status: 404 })),
    )
    const store = new OneDriveAssetStore('', { ...connection })

    await expect(store.stat('missing.stl')).resolves.toBeUndefined()
  })

  it('shares one token refresh across concurrent requests', async () => {
    let tokenRequests = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
        if (url.endsWith('/oauth2/v2.0/token')) {
          tokenRequests++
          await new Promise((resolve) => setTimeout(resolve, 5))
          return Response.json({ access_token: 'access-token', expires_in: 3_600 })
        }
        return Response.json({ id: 'file-id', name: 'model.stl', size: 5 })
      }),
    )
    const store = new OneDriveAssetStore('', { ...connection })

    await Promise.all([store.stat('one.stl'), store.stat('two.stl')])

    expect(tokenRequests).toBe(1)
  })
})
