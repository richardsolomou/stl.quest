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

    await expect(store.inventory()).resolves.toEqual({ files: 1, folders: 2, bytes: 4 })
    expect(remote.inventoryRequests.every((request) => !request.deep)).toBe(true)
  })
})

function fakeWebDAV() {
  const files = new Map<string, Buffer>()
  const directories = new Set<string>()
  const directoryRequests: string[] = []
  const inventoryRequests: { path: string; deep: boolean }[] = []
  const client = {
    createDirectory: async (path: string) => {
      directoryRequests.push(path)
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
  return { client, files, directoryRequests, inventoryRequests }
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
