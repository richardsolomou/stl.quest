import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GoogleDriveAssetStore } from './googleDrive'

const connection = { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'refresh-token' }
const folderMime = 'application/vnd.google-apps.folder'

function jsonBody<T>(init?: RequestInit) {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body')
  return JSON.parse(init.body) as T
}

function googleDriveApi() {
  type File = { id: string; name: string; mimeType: string; size?: string; parents: string[]; bytes?: Uint8Array }
  const files = new Map<string, File>([['root-folder', { id: 'root-folder', name: 'PrintHub', mimeType: folderMime, parents: ['root'] }]])
  const uploads = new Map<string, { id: string; name: string; parent: string }>()
  let nextId = 1
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input)
    const method = init?.method ?? 'GET'
    if (url.href === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'access-token', expires_in: 3_600 })
    if (url.hostname === 'upload.example') {
      const upload = uploads.get(url.pathname)!
      const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer())
      files.set(upload.id, {
        id: upload.id,
        name: upload.name,
        mimeType: 'application/octet-stream',
        size: String(bytes.byteLength),
        parents: [upload.parent],
        bytes,
      })
      return Response.json({ id: upload.id, size: String(bytes.byteLength) })
    }
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const query = url.searchParams.get('q') ?? ''
      if (query.includes("key='printhubRoot'")) return Response.json({ files: [files.get('root-folder')] })
      const parent = query.match(/^'([^']+)' in parents/)?.[1]
      const name = query.match(/name='([^']+)'/)?.[1]
      const wantsFolder = query.includes(`mimeType='${folderMime}'`)
      return Response.json({
        files: [...files.values()].filter(
          (file) => file.parents.includes(parent ?? '') && file.name === name && (file.mimeType === folderMime) === wantsFolder,
        ),
      })
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const body = jsonBody<{ name: string; mimeType: string; parents: string[] }>(init)
      const id = `file-${nextId++}`
      const file = { id, name: body.name, mimeType: body.mimeType, parents: body.parents }
      files.set(id, file)
      return Response.json(file)
    }
    if (url.pathname === '/upload/drive/v3/files' && url.searchParams.get('uploadType') === 'resumable') {
      const body = jsonBody<{ name: string; parents: string[] }>(init)
      const id = `file-${nextId++}`
      const uploadPath = `/session-${id}`
      uploads.set(uploadPath, { id, name: body.name, parent: body.parents[0] })
      return new Response(null, { headers: { location: `https://upload.example${uploadPath}` } })
    }
    if (url.pathname === '/upload/drive/v3/files' && url.searchParams.get('uploadType') === 'multipart') {
      const body = Buffer.from(await new Response(init?.body).arrayBuffer()).toString()
      const metadata = JSON.parse(body.match(/\r\n\r\n(\{.*?\})\r\n--/)![1]) as { name: string; parents: string[] }
      const id = `file-${nextId++}`
      files.set(id, {
        id,
        name: metadata.name,
        mimeType: 'application/octet-stream',
        size: '1',
        parents: metadata.parents,
        bytes: new Uint8Array([1]),
      })
      return Response.json({ id, size: '1' })
    }
    const fileId = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)?.[1]
    if (fileId && method === 'PATCH') {
      const file = files.get(fileId)!
      const body = jsonBody<{ name: string }>(init)
      file.name = body.name
      file.parents = [url.searchParams.get('addParents')!]
      return Response.json(file)
    }
    if (fileId && method === 'DELETE') {
      return files.delete(fileId) ? new Response(null, { status: 204 }) : Response.json({}, { status: 404 })
    }
    if (fileId && url.searchParams.get('alt') === 'media') {
      const file = files.get(fileId)!
      return new Response(file.bytes ? Buffer.from(file.bytes) : undefined)
    }
    throw new Error(`Unexpected Google Drive request: ${method} ${url}`)
  })
  return { fetch, files }
}

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

  it('honors the crash-recovery asset store contract', async () => {
    const api = googleDriveApi()
    vi.stubGlobal('fetch', api.fetch)
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-google-contract-'))
    const stagedPath = path.join(directory, 'upload.part')
    await fs.promises.writeFile(stagedPath, 'model')
    const store = new GoogleDriveAssetStore('', connection)

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
      for (const invalidPath of ['', '.', '..', 'todo/', 'todo/.', 'todo/..', '../outside'])
        await expect(store.exists(invalidPath)).rejects.toThrow()
      await store.writable()

      expect([...api.files.values()].filter((file) => file.mimeType !== folderMime)).toHaveLength(0)
    } finally {
      await fs.promises.rm(directory, { recursive: true, force: true })
    }
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
