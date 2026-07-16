import { afterEach, describe, expect, it, vi } from 'vitest'
import { DropboxAssetStore } from './dropbox'

const connection = {
  clientId: 'app-key',
  clientSecret: 'app-secret',
  refreshToken: 'refresh-token',
}

describe('DropboxAssetStore', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uploads streams through a session without buffering the whole asset', async () => {
    const requests: Array<{ url: string; argument?: unknown; bytes: number }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
        const headers = new Headers(init?.headers)
        const body = init?.body
        requests.push({
          url,
          argument: headers.get('dropbox-api-arg') ? JSON.parse(headers.get('dropbox-api-arg')!) : undefined,
          bytes:
            typeof body === 'string'
              ? Buffer.byteLength(body)
              : body instanceof URLSearchParams
                ? Buffer.byteLength(body.toString())
                : body
                  ? Buffer.from(body as ArrayBuffer).byteLength
                  : 0,
        })
        if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'access-token', expires_in: 14_400 })
        if (url.endsWith('/files/upload_session/start')) return Response.json({ session_id: 'session-id' })
        if (url.endsWith('/files/upload_session/append_v2')) return Response.json(null)
        if (url.endsWith('/files/upload_session/finish')) return Response.json({ '.tag': 'file', size: 5 })
        return Response.json({ metadata: { '.tag': 'folder' } })
      }),
    )
    const store = new DropboxAssetStore('PrintHub', connection)

    await store.writeStream('todo/model.stl', new Blob(['model']).stream(), 5)

    expect(requests.find((request) => request.url.endsWith('/files/upload_session/append_v2'))).toMatchObject({
      argument: { cursor: { session_id: 'session-id', offset: 0 }, close: false },
      bytes: 5,
    })
    expect(requests.find((request) => request.url.endsWith('/files/upload_session/finish'))).toMatchObject({
      argument: {
        cursor: { session_id: 'session-id', offset: 5 },
        commit: { path: '/PrintHub/todo/model.stl', mode: 'overwrite', autorename: false, mute: true, strict_conflict: false },
      },
      bytes: 0,
    })
  })

  it('returns missing metadata as an absent asset', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: 'access-token', expires_in: 14_400 }))
        .mockResolvedValueOnce(Response.json({ error_summary: 'path/not_found/' }, { status: 409, statusText: 'Conflict' })),
    )
    const store = new DropboxAssetStore('', connection)

    await expect(store.stat('todo/missing.stl')).resolves.toBeUndefined()
  })

  it('streams downloads with their Dropbox metadata size', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: 'access-token', expires_in: 14_400 }))
        .mockResolvedValueOnce(
          new Response('model', {
            headers: { 'dropbox-api-result': JSON.stringify({ '.tag': 'file', size: 5 }) },
          }),
        ),
    )
    const store = new DropboxAssetStore('', connection)

    const asset = await store.read('todo/model.stl')

    expect(asset.size).toBe(5)
  })

  it('escapes Unicode paths in Dropbox API headers', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'access-token', expires_in: 14_400 }))
      .mockResolvedValueOnce(new Response('model', { headers: { 'dropbox-api-result': JSON.stringify({ '.tag': 'file', size: 5 }) } }))
    vi.stubGlobal('fetch', fetch)
    const store = new DropboxAssetStore('', connection)

    await store.read('todo/δοκιμή.stl')

    expect(new Headers(fetch.mock.calls[1][1]?.headers).get('dropbox-api-arg')).toContain('\\u03b4')
  })

  it('retries Dropbox write contention responses', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'access-token', expires_in: 14_400 }))
      .mockResolvedValueOnce(Response.json({ error: { reason: { '.tag': 'too_many_write_operations' }, retry_after: 0 } }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ metadata: { '.tag': 'folder' } }))
      .mockResolvedValueOnce(Response.json({ '.tag': 'file', size: 5 }))
    vi.stubGlobal('fetch', fetch)
    const store = new DropboxAssetStore('', connection)

    const writing = store.write('todo/model.stl', new TextEncoder().encode('model'))
    await vi.runAllTimersAsync()
    await writing

    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('creates each Dropbox folder once and sequentially', async () => {
    let activeRequests = 0
    let maximumActiveRequests = 0
    const createdPaths: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
        if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'access-token', expires_in: 14_400 })
        if (typeof init?.body === 'string') createdPaths.push(JSON.parse(init.body).path)
        activeRequests++
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
        await new Promise((resolve) => setTimeout(resolve, 1))
        activeRequests--
        return Response.json({ metadata: { '.tag': 'folder' } })
      }),
    )
    const store = new DropboxAssetStore('', connection)

    await store.initialize()

    expect(maximumActiveRequests).toBe(1)
    expect(createdPaths).toEqual([...new Set(createdPaths)])
  })

  it('removes the source when a completed move is retried', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'access-token', expires_in: 14_400 }))
      .mockResolvedValueOnce(Response.json({ '.tag': 'file', size: 5 }))
      .mockResolvedValueOnce(Response.json({ '.tag': 'file', size: 5 }))
      .mockResolvedValueOnce(Response.json({ metadata: { '.tag': 'file' } }))
    vi.stubGlobal('fetch', fetch)
    const store = new DropboxAssetStore('', connection)

    await store.ensureMoved('todo/model.stl', 'done/model.stl')

    expect(fetch.mock.calls[3][0]).toContain('/files/delete_v2')
  })
})
