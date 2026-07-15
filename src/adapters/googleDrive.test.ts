import { afterEach, describe, expect, it, vi } from 'vitest'
import { GoogleDriveAssetStore } from './googleDrive'

const connection = { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'refresh-token' }

describe('GoogleDriveAssetStore', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uploads streams through a resumable session', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'access-token', expires_in: 3_600 }))
      .mockResolvedValueOnce(
        Response.json({ files: [{ id: 'root-id', name: 'PrintHub', mimeType: 'application/vnd.google-apps.folder' }] }),
      )
      .mockResolvedValueOnce(Response.json({ files: [] }))
      .mockResolvedValueOnce(new Response(null, { headers: { location: 'https://upload.example/session' } }))
      .mockResolvedValueOnce(Response.json({ id: 'file-id', size: '5' }))
    vi.stubGlobal('fetch', fetch)
    const store = new GoogleDriveAssetStore('', connection)

    await store.writeStream('model.stl', new Blob(['model']).stream(), 5)

    expect(fetch.mock.calls[4][0]).toBe('https://upload.example/session')
    expect(new Headers(fetch.mock.calls[4][1]?.headers).get('content-range')).toBe('bytes 0-4/5')
  })

  it('returns missing files as absent assets', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: 'access-token', expires_in: 3_600 }))
        .mockResolvedValueOnce(
          Response.json({ files: [{ id: 'root-id', name: 'PrintHub', mimeType: 'application/vnd.google-apps.folder' }] }),
        )
        .mockResolvedValueOnce(Response.json({ files: [] })),
    )
    const store = new GoogleDriveAssetStore('', connection)

    await expect(store.stat('missing.stl')).resolves.toBeUndefined()
  })
})
