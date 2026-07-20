import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { BufferLike, FileStat, WebDAVClient } from 'webdav'
import { WebDAVAssetStore } from './webdav'

describe('WebDAVAssetStore', () => {
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
})

function fakeWebDAV() {
  const files = new Map<string, Buffer>()
  const directories = new Set<string>()
  const client = {
    createDirectory: async (path: string) => {
      directories.add(path)
    },
    putFileContents: async (path: string, data: string | BufferLike | Readable) => {
      files.set(path, await toBuffer(data))
      return true
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
  } as unknown as WebDAVClient
  return { client, files }
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
