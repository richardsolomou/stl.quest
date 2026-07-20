import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OneDriveAssetStore } from './oneDrive'

const connection = { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'refresh-token' }

function jsonBody<T>(init?: RequestInit) {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body')
  return JSON.parse(init.body) as T
}

function oneDriveApi() {
  type Item = { id: string; name: string; path: string; folder?: object; size?: number; bytes?: Uint8Array }
  const items = new Map<string, Item>([['root-id', { id: 'root-id', name: 'approot', path: '', folder: {} }]])
  const uploads = new Map<string, string>()
  let nextId = 1
  const byPath = (itemPath: string) => [...items.values()].find((item) => item.path === itemPath)
  const graphPath = (url: URL) => {
    const prefix = '/v1.0/me/drive/special/approot:/'
    if (!url.pathname.startsWith(prefix)) return undefined
    return url.pathname
      .slice(prefix.length)
      .replace(/:\/(?:content|createUploadSession)$/, '')
      .split('/')
      .map(decodeURIComponent)
      .join('/')
  }
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input)
    const method = init?.method ?? 'GET'
    if (url.pathname.endsWith('/oauth2/v2.0/token')) return Response.json({ access_token: 'access-token', expires_in: 3_600 })
    if (url.hostname === 'upload.example') {
      const itemPath = uploads.get(url.pathname)!
      const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer())
      const existing = byPath(itemPath)
      const item = existing ?? { id: `item-${nextId++}`, name: itemPath.split('/').pop()!, path: itemPath }
      Object.assign(item, { size: bytes.byteLength, bytes })
      items.set(item.id, item)
      return Response.json({ id: item.id, size: bytes.byteLength })
    }
    if (url.pathname === '/v1.0/me/drive/special/approot') return Response.json(items.get('root-id'))
    const itemPath = graphPath(url)
    if (itemPath !== undefined) {
      if (url.pathname.endsWith(':/createUploadSession')) {
        const uploadPath = `/session-${nextId++}`
        uploads.set(uploadPath, itemPath)
        return Response.json({ uploadUrl: `https://upload.example${uploadPath}` })
      }
      if (url.pathname.endsWith(':/content')) {
        if (method === 'PUT') {
          const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer())
          const existing = byPath(itemPath)
          const item = existing ?? { id: `item-${nextId++}`, name: itemPath.split('/').pop()!, path: itemPath }
          Object.assign(item, { size: bytes.byteLength, bytes })
          items.set(item.id, item)
          return Response.json(item)
        }
        const item = byPath(itemPath)
        return item
          ? new Response(item.bytes ? Buffer.from(item.bytes) : undefined)
          : Response.json({ error: { code: 'itemNotFound' } }, { status: 404 })
      }
      const item = byPath(itemPath)
      return item ? Response.json(item) : Response.json({ error: { code: 'itemNotFound' } }, { status: 404 })
    }
    const child = url.pathname.match(/^\/v1\.0\/me\/drive\/items\/([^:]+):\/([^/]+)$/)
    if (child) {
      const parent = items.get(decodeURIComponent(child[1]))!
      const item = byPath([parent.path, decodeURIComponent(child[2])].filter(Boolean).join('/'))
      return item ? Response.json(item) : Response.json({ error: { code: 'itemNotFound' } }, { status: 404 })
    }
    const children = url.pathname.match(/^\/v1\.0\/me\/drive\/items\/([^/]+)\/children$/)
    if (children && method === 'POST') {
      const parent = items.get(decodeURIComponent(children[1]))!
      const body = jsonBody<{ name: string }>(init)
      const item = { id: `item-${nextId++}`, name: body.name, path: [parent.path, body.name].filter(Boolean).join('/'), folder: {} }
      items.set(item.id, item)
      return Response.json(item)
    }
    const itemId = url.pathname.match(/^\/v1\.0\/me\/drive\/items\/([^/]+)$/)?.[1]
    if (itemId && method === 'PATCH') {
      const item = items.get(decodeURIComponent(itemId))!
      const body = jsonBody<{ name: string; parentReference: { id: string } }>(init)
      const parent = items.get(body.parentReference.id)!
      item.name = body.name
      item.path = [parent.path, body.name].filter(Boolean).join('/')
      return Response.json(item)
    }
    if (itemId && method === 'DELETE') {
      return items.delete(decodeURIComponent(itemId)) ? new Response(null, { status: 204 }) : Response.json({}, { status: 404 })
    }
    throw new Error(`Unexpected OneDrive request: ${method} ${url}`)
  })
  return { fetch, items }
}

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

  it('honors the crash-recovery asset store contract', async () => {
    const api = oneDriveApi()
    vi.stubGlobal('fetch', api.fetch)
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-onedrive-contract-'))
    const stagedPath = path.join(directory, 'upload.part')
    await fs.promises.writeFile(stagedPath, 'model')
    const store = new OneDriveAssetStore('', { ...connection })

    try {
      await store.finalizeUpload(stagedPath, 'todo/model.stl')
      await store.finalizeUpload(stagedPath, 'todo/model.stl')
      await store.ensureMoved('todo/model.stl', 'done/model.stl')
      await store.ensureMoved('todo/model.stl', 'done/model.stl')
      await store.write('todo/replayed.stl', new TextEncoder().encode('same'))
      await store.write('done/replayed.stl', new TextEncoder().encode('same'))
      await store.ensureMoved('todo/replayed.stl', 'done/replayed.stl')
      expect(await store.exists('todo/replayed.stl')).toBe(false)
      await store.remove('done/replayed.stl')
      await expect(store.ensureMoved('todo/missing.stl', 'done/missing.stl')).rejects.toMatchObject({ code: 'ENOENT' })
      const operationId = '11111111-1111-4111-8111-111111111111'
      const trashPath = store.trashPath(operationId, 'done/model.stl')
      expect(store.trashPath(operationId, 'done/model.stl')).toBe(trashPath)
      await store.ensureMoved('done/model.stl', trashPath)
      await store.purgeTrash(trashPath)
      await store.purgeTrash(trashPath)
      await expect(store.exists('../outside')).rejects.toThrow()
      await store.writable()

      expect([...api.items.values()].filter((item) => !item.folder)).toHaveLength(0)
    } finally {
      await fs.promises.rm(directory, { recursive: true, force: true })
    }
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
