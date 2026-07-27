import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BufferLike, FileStat, WebDAVClient } from 'webdav'
import { WebDAVAssetStore } from './webdav'

describe('WebDAVAssetStore', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('stores and moves ordinary files below the configured folder', async () => {
    const remote = fakeWebDAV()
    const store = new WebDAVAssetStore(
      { adapter: 'webdav', endpoint: 'https://storage.example.com/dav', root: 'visible', username: 'user', password: 'secret' },
      remote.client,
    )

    await store.initialize()
    await store.write('todo/model.stl', new TextEncoder().encode('mesh'))
    await store.ensureMoved('todo/model.stl', 'done/model.stl')

    expect(remote.files.get('/visible/done/model.stl')?.toString()).toBe('mesh')
    expect(remote.files.has('/visible/todo/model.stl')).toBe(false)
    const asset = await store.read('done/model.stl')
    expect(Buffer.from(await new Response(asset.stream).arrayBuffer()).toString()).toBe('mesh')
    await expect(store.exists('../outside')).rejects.toMatchObject({ status: 400 })
  })

  it('falls back to streaming a file when the server rejects MOVE', async () => {
    const remote = fakeWebDAV()
    remote.client.moveFile = async () => {
      throw Object.assign(new Error('bad gateway'), { status: 502 })
    }
    const store = new WebDAVAssetStore(
      { adapter: 'webdav', endpoint: 'https://storage.example.com/dav', root: 'visible', username: 'user', password: 'secret' },
      remote.client,
    )

    await store.write('todo/model.stl', new TextEncoder().encode('mesh'))
    await store.ensureMoved('todo/model.stl', 'done/model.stl')

    expect(remote.files.has('/visible/todo/model.stl')).toBe(false)
    expect(remote.files.get('/visible/done/model.stl')?.toString()).toBe('mesh')
  })

  it('uploads large files in partial updates when the server advertises support', async () => {
    const remote = fakeWebDAV()
    remote.compliance.push('sabredav-partialupdate')
    const store = new WebDAVAssetStore(
      { adapter: 'webdav', endpoint: 'https://storage.example.com/dav', root: 'visible', username: 'user', password: 'secret' },
      remote.client,
      3,
    )

    await store.writeStream('todo/model.stl', new Blob(['12345678']).stream(), 8)

    expect(remote.partialUpdateRequests).toEqual([
      { path: '/visible/todo/model.stl', start: 0, end: 2 },
      { path: '/visible/todo/model.stl', start: 3, end: 5 },
      { path: '/visible/todo/model.stl', start: 6, end: 7 },
    ])
    expect(remote.files.get('/visible/todo/model.stl')?.toString()).toBe('12345678')
  })

  it('uses partial updates when finalizing a staged tus upload', async () => {
    const remote = fakeWebDAV()
    remote.compliance.push('sabredav-partialupdate')
    const store = new WebDAVAssetStore(
      { adapter: 'webdav', endpoint: 'https://storage.example.com/dav', root: 'visible', username: 'user', password: 'secret' },
      remote.client,
      3,
    )
    const stagedPath = nodePath.join(await fs.promises.mkdtemp(nodePath.join(os.tmpdir(), 'stlquest-webdav-')), 'upload')
    await fs.promises.writeFile(stagedPath, '12345678')

    await store.finalizeUpload(stagedPath, 'todo/model.stl')

    expect(remote.partialUpdateRequests).toHaveLength(3)
    expect(remote.files.get('/visible/todo/model.stl')?.toString()).toBe('12345678')
    await expect(fs.promises.stat(stagedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await fs.promises.rm(nodePath.dirname(stagedPath), { recursive: true, force: true })
  })

  it('uses one PUT when the server does not support partial updates', async () => {
    const remote = fakeWebDAV()
    const store = new WebDAVAssetStore(
      { adapter: 'webdav', endpoint: 'https://storage.example.com/dav', root: 'visible', username: 'user', password: 'secret' },
      remote.client,
      3,
    )

    await store.writeStream('todo/model.stl', new Blob(['12345678']).stream(), 8)

    expect(remote.partialUpdateRequests).toEqual([])
    expect(remote.files.get('/visible/todo/model.stl')?.toString()).toBe('12345678')
  })

  it('uses Apache partial updates when a Cloudflare proxy hides the origin server header', async () => {
    const remote = fakeWebDAV()
    remote.compliance.push('<http://apache.org/dav/propset/fs/1>')
    const store = new WebDAVAssetStore(
      { adapter: 'webdav', endpoint: 'https://storage.example.com/dav', root: 'visible', username: 'user', password: 'secret' },
      remote.client,
      3,
    )

    await store.writeStream('todo/model.stl', new Blob(['12345678']).stream(), 8)

    expect(remote.partialUpdateRequests).toHaveLength(3)
    expect(remote.files.get('/visible/todo/model.stl')?.toString()).toBe('12345678')
  })

  it('uses canonical collection paths while creating folders', async () => {
    const remote = fakeWebDAV()
    const store = new WebDAVAssetStore(
      { adapter: 'webdav', endpoint: 'https://storage.example.com/dav', root: 'visible', username: 'user', password: 'secret' },
      remote.client,
    )

    await store.initialize()

    expect(remote.directoryRequests.every((path) => path.endsWith('/'))).toBe(true)
  })

  it('inventories recursively without requesting infinite-depth listings', async () => {
    const remote = fakeWebDAV()
    const store = new WebDAVAssetStore(
      { adapter: 'webdav', endpoint: 'https://storage.example.com/dav', root: 'visible', username: 'user', password: 'secret' },
      remote.client,
    )
    await store.initialize()
    await store.write('existing/nested/model.stl', new TextEncoder().encode('mesh'))

    await expect(store.inventory()).resolves.toMatchObject({
      files: 1,
      folders: expect.any(Number),
      bytes: 4,
      entries: expect.arrayContaining([
        { path: 'existing', type: 'folder' },
        { path: 'existing/nested/model.stl', type: 'file', bytes: 4 },
      ]),
      truncated: false,
    })
    expect(remote.inventoryRequests.every((request) => !request.deep)).toBe(true)
  })

  it('deletes each child with the native transport while preserving the configured collection', async () => {
    const remote = fakeWebDAV()
    const request = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', request)
    const store = new WebDAVAssetStore(
      { adapter: 'webdav', endpoint: 'https://storage.example.com/dav', root: 'visible folder', username: 'user', password: 'secret' },
      remote.client,
    )

    await store.initialize()
    await store.write('existing/model.stl', new TextEncoder().encode('mesh'))
    await store.clear({ initialize: false })

    expect(request).not.toHaveBeenCalledWith('https://storage.example.com/dav/visible%20folder/', expect.anything())
    expect(request).toHaveBeenCalledWith(
      'https://storage.example.com/dav/visible%20folder/existing/',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

function fakeWebDAV() {
  const files = new Map<string, Buffer>()
  const directories = new Set<string>()
  const directoryRequests: string[] = []
  const inventoryRequests: { path: string; deep: boolean }[] = []
  const compliance: string[] = []
  const partialUpdateRequests: Array<{ path: string; start: number; end: number }> = []
  const client = {
    createDirectory: async (path: string) => {
      directoryRequests.push(path)
      directories.add(path)
    },
    putFileContents: async (path: string, data: string | BufferLike | Readable) => {
      files.set(path, await toBuffer(data))
      return true
    },
    getDAVCompliance: async () => ({ compliance, server: 'test' }),
    partialUpdateFileContents: async (path: string, start: number, end: number, data: string | BufferLike | Readable) => {
      partialUpdateRequests.push({ path, start, end })
      const current = files.get(path) ?? Buffer.alloc(0)
      const next = Buffer.alloc(Math.max(current.length, end + 1))
      current.copy(next)
      ;(await toBuffer(data)).copy(next, start)
      files.set(path, next)
    },
    customRequest: async (path: string, request: { headers?: Record<string, string>; data?: Buffer }) => {
      const range = request.headers?.['Content-Range']?.match(/^bytes (\d+)-(\d+)\/\*$/)
      if (!range || !request.data) throw new Error('invalid partial update')
      await client.partialUpdateFileContents(path, Number(range[1]), Number(range[2]), request.data)
      return new Response(null, { status: 204 })
    },
    stat: async (path: string): Promise<FileStat> => {
      const file = files.get(path)
      if (file) return { filename: path, basename: path.split('/').at(-1)!, lastmod: '', size: file.length, type: 'file', etag: null }
      if (directories.has(path))
        return { filename: path, basename: path.split('/').at(-1)!, lastmod: '', size: 0, type: 'directory', etag: null }
      throw Object.assign(new Error('not found'), { status: 404 })
    },
    createReadStream: (path: string) => Readable.from(files.get(path) ?? []),
    moveFile: async (source: string, destination: string) => {
      const file = files.get(source)
      if (!file) throw Object.assign(new Error('not found'), { status: 404 })
      files.set(destination, file)
      files.delete(source)
    },
    deleteFile: async (path: string) => {
      files.delete(path)
      for (const candidate of files.keys()) if (candidate.startsWith(`${path}/`)) files.delete(candidate)
      directories.delete(path)
    },
    getDirectoryContents: async (path: string, options: { deep: boolean }) => {
      inventoryRequests.push({ path, deep: options.deep })
      const prefix = `${path.replace(/\/$/, '')}/`
      return [
        ...[...directories]
          .filter((candidate) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).replace(/\/$/, '').includes('/'))
          .map((candidate) => fileStat(candidate.replace(/\/$/, ''), 'directory', 0)),
        ...[...files]
          .filter(([candidate]) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes('/'))
          .map(([candidate, contents]) => fileStat(candidate, 'file', contents.length)),
      ]
    },
  } as unknown as WebDAVClient
  return { client, files, directoryRequests, inventoryRequests, compliance, partialUpdateRequests }
}

function fileStat(filename: string, type: FileStat['type'], size: number): FileStat {
  return { filename, basename: filename.split('/').at(-1)!, lastmod: '', size, type, etag: null }
}

async function toBuffer(data: string | BufferLike | Readable) {
  if (typeof data === 'string') return Buffer.from(data)
  if (data instanceof Readable) {
    const chunks: Buffer[] = []
    for await (const chunk of data) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  }
  return Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data))
}
