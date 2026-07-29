import { describe, expect, it, vi } from 'vitest'
import { BoxAssetStore } from './box'

describe('BoxAssetStore', () => {
  it('uploads streams in parts and persists rotated refresh tokens', async () => {
    const rotated = vi.fn()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'access', expires_in: 3600, refresh_token: 'rotated' }))
      .mockResolvedValueOnce(Response.json({ entries: [{ id: 'app', type: 'folder', name: 'STL Quest' }], total_count: 1 }))
      .mockResolvedValueOnce(Response.json({ entries: [{ id: 'todo', type: 'folder', name: 'todo' }], total_count: 1 }))
      .mockResolvedValueOnce(Response.json({ entries: [], total_count: 0 }))
      .mockResolvedValueOnce(
        Response.json({
          id: 'session',
          part_size: 8,
          session_endpoints: { upload_part: 'https://upload.box.test/part', commit: 'https://upload.box.test/commit' },
        }),
      )
      .mockResolvedValueOnce(Response.json({ part: { part_id: 'part', offset: 0, size: 5, sha1: 'digest' } }))
      .mockResolvedValueOnce(Response.json({ entries: [{ id: 'file', type: 'file', name: 'model.stl', size: 5 }] }))
    vi.stubGlobal('fetch', fetch)
    await new BoxAssetStore('', { clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh' }, rotated).writeStream(
      'todo/model.stl',
      new Blob(['model']).stream(),
      5,
    )
    expect(rotated).toHaveBeenCalledWith('rotated')
    expect(fetch).toHaveBeenCalledWith('https://upload.box.test/part', expect.objectContaining({ method: 'PUT' }))
    expect(fetch).toHaveBeenCalledWith('https://upload.box.test/commit', expect.objectContaining({ method: 'POST' }))
  })
})
