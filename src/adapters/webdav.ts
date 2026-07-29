import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { AuthType, createClient, type FileStat, type WebDAVClient, type WebDAVClientError } from 'webdav'
import { STORAGE_SCAFFOLD_FOLDERS } from '../core/assetKeys'
import type { AssetStore, StorageConfig } from '../core/types'
import { hasTraversalSegment } from '../core/storagePath'
import { assertStreamSize, streamChunks } from './streamChunks'
import { AssetStoreKeys } from './assetStoreKeys'
import { StorageInventoryBuilder } from './storageInventory'
import { assetMissingError, uploadPartMissingError } from './missingFile'

type WebDAVConfig = Extract<StorageConfig, { adapter: 'webdav' }>
type PartialUpdateMode = 'apache' | 'sabredav'
type WebDAVCapabilities = { partialUpdateMode?: PartialUpdateMode; cloudflare: boolean }
const PARTIAL_UPLOAD_CHUNK_BYTES = 50 * 1024 * 1024
const APACHE_PARTIAL_UPDATE = '<http://apache.org/dav/propset/fs/1>'
const READ_CONCURRENCY = 4

class ConcurrencyGate {
  private active = 0
  private waiters: Array<() => void> = []

  constructor(private limit: number) {}

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const enter = () => {
        this.active++
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.active--
          this.waiters.shift()?.()
        })
      }
      if (this.active < this.limit) enter()
      else this.waiters.push(enter)
    })
  }
}

export class WebDAVAssetStore extends AssetStoreKeys implements AssetStore {
  private directories = new Set<string>()
  private folders = new Map<string, Promise<void>>()
  private root: string
  private client: WebDAVClient
  private endpoint: string
  private username: string
  private password: string
  private capabilities?: WebDAVCapabilities
  private reads: ConcurrencyGate

  constructor(
    config: WebDAVConfig,
    client?: WebDAVClient,
    private partialUploadChunkBytes = PARTIAL_UPLOAD_CHUNK_BYTES,
    readConcurrency = READ_CONCURRENCY,
  ) {
    super()
    this.root = cleanRoot(config.root)
    this.endpoint = config.endpoint
    this.username = config.username
    this.password = config.password
    this.client = client ?? createClient(config.endpoint, { authType: AuthType.Auto, username: config.username, password: config.password })
    this.reads = new ConcurrencyGate(readConcurrency)
  }

  async initialize() {
    for (const folder of STORAGE_SCAFFOLD_FOLDERS) await this.createFolder(folder)
  }

  async finalizeUpload(stagedPath: string, relativePath: string) {
    const [staged, destination] = await Promise.all([
      fs.promises.stat(stagedPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      }),
      this.stat(relativePath),
    ])
    if (!staged && destination) return
    if (!staged) throw uploadPartMissingError(stagedPath)
    if (destination) {
      if (destination.size !== staged.size) throw new Error(`upload destination already exists: ${relativePath}`)
    } else {
      await this.uploadStream(relativePath, Readable.toWeb(fs.createReadStream(stagedPath)) as ReadableStream, staged.size, false)
    }
    await fs.promises.rm(stagedPath, { force: true })
  }

  async write(relativePath: string, bytes: Uint8Array) {
    await this.ensureParent(relativePath)
    await this.client.putFileContents(this.remotePath(relativePath), Buffer.from(bytes), { overwrite: true })
  }

  async writeStream(relativePath: string, stream: ReadableStream, size: number) {
    await this.uploadStream(relativePath, stream, size, true)
  }

  private async uploadStream(relativePath: string, stream: ReadableStream, size: number, overwrite: boolean) {
    await this.ensureParent(relativePath)
    const capabilities = size > this.partialUploadChunkBytes ? await this.getCapabilities() : undefined
    const partialUpdateMode = capabilities?.partialUpdateMode
    if (partialUpdateMode) {
      const remotePath = this.remotePath(relativePath)
      await this.client.putFileContents(remotePath, Buffer.alloc(0), { overwrite })
      let offset = 0
      for await (const chunk of streamChunks(stream, this.partialUploadChunkBytes)) {
        const end = offset + chunk.byteLength - 1
        await this.partialUpdate(remotePath, offset, end, chunk, partialUpdateMode)
        offset = end + 1
      }
      assertStreamSize(offset, size, relativePath)
      return
    }
    try {
      await this.client.putFileContents(
        this.remotePath(relativePath),
        Readable.fromWeb(stream as import('node:stream/web').ReadableStream),
        {
          contentLength: size,
          overwrite,
        },
      )
    } catch (error) {
      if ((error as WebDAVClientError).status === 413 && capabilities?.cloudflare) {
        throw Object.assign(
          new Error(
            'Cloudflare rejected this file because it exceeds the plan upload limit. Switch the WebDAV endpoint to Tailscale Funnel using the WebDAV setup guide, then retry.',
            { cause: error },
          ),
          { status: 413, cloudflare: true },
        )
      }
      throw error
    }
  }

  async read(relativePath: string) {
    const release = await this.reads.acquire()
    try {
      const stat = await this.fileStat(relativePath)
      const stream = this.client.createReadStream(this.remotePath(relativePath))
      stream.once('close', release)
      stream.once('end', release)
      stream.once('error', release)
      return {
        stream: Readable.toWeb(stream) as ReadableStream,
        size: stat.size,
      }
    } catch (error) {
      release()
      throw error
    }
  }

  async stat(relativePath: string) {
    try {
      const stat = await this.fileStat(relativePath)
      return stat.type === 'file' ? { size: stat.size } : undefined
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }

  async ensureMoved(sourcePath: string, destinationPath: string) {
    if (sourcePath === destinationPath) return
    const [source, destination] = await Promise.all([this.stat(sourcePath), this.stat(destinationPath)])
    if (!source && destination) return
    if (!source) throw assetMissingError(sourcePath)
    if (destination && destination.size !== source.size) throw new Error(`asset destination already exists: ${destinationPath}`)
    if (destination) return this.remove(sourcePath)
    await this.ensureParent(destinationPath)
    try {
      await this.client.moveFile(this.remotePath(sourcePath), this.remotePath(destinationPath), { overwrite: false })
    } catch {
      await this.moveByStreaming(sourcePath, destinationPath, source.size)
    }
  }

  async exists(relativePath: string) {
    return !!(await this.stat(relativePath))
  }

  async remove(relativePath: string) {
    try {
      await this.client.deleteFile(this.remotePath(relativePath))
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }

  async removeEmptyDirectory(relativePath: string) {
    try {
      const contents = await this.client.getDirectoryContents(this.remotePath(relativePath), { deep: false })
      if (!Array.isArray(contents) || contents.length > 0) return false
      await this.remove(relativePath)
      return true
    } catch (error) {
      if (isNotFound(error)) return true
      throw error
    }
  }

  async trash(relativePath: string) {
    if (!(await this.stat(relativePath))) return undefined
    const next = `.stlquest/trash/${crypto.randomUUID()}__${path.posix.basename(relativePath)}`
    await this.ensureMoved(relativePath, next)
    return next
  }

  async sweepTrash() {
    const trash = this.remotePath('.stlquest/trash')
    const contents = await this.client.getDirectoryContents(trash, { deep: false })
    if (!Array.isArray(contents)) throw new Error('WebDAV trash listing returned an invalid response')
    for (const entry of contents) {
      const relativePath = this.relativePath(entry.filename)
      if (relativePath === '.stlquest/trash') continue
      if (!relativePath.startsWith('.stlquest/trash/')) throw new Error('WebDAV trash listing returned an item outside the trash folder')
      await this.deleteNative(`${this.root}/${relativePath}`, entry.type === 'directory')
    }
  }

  async writable() {
    const probe = `.stlquest/health-${crypto.randomUUID()}`
    await this.write(probe, new Uint8Array())
    await this.remove(probe)
  }

  async inventory() {
    const directories = [`/${this.root}`]
    const visited = new Set<string>()
    const inventory = new StorageInventoryBuilder()

    while (directories.length > 0) {
      const directory = directories.pop()!
      if (visited.has(directory)) continue
      visited.add(directory)
      const contents = await this.client.getDirectoryContents(directory, { deep: false })
      if (!Array.isArray(contents)) throw new Error('WebDAV inventory returned an invalid response')
      for (const entry of contents) {
        const relative = entry.filename
          .replace(/^\/+/, '')
          .slice(this.root.length)
          .replace(/^\/+|\/$/g, '')
        if (!relative) continue
        if (entry.type === 'directory') {
          directories.push(entry.filename)
          inventory.addFolder(relative)
        } else {
          inventory.addFile(relative, entry.size)
        }
      }
    }
    return inventory.result()
  }

  async clear(options?: { initialize?: boolean }) {
    const contents = await this.client.getDirectoryContents(`/${this.root}`, { deep: false })
    if (!Array.isArray(contents)) throw new Error('WebDAV folder listing returned an invalid response')
    for (const entry of contents) {
      const relativePath = this.relativePath(entry.filename)
      if (relativePath) await this.deleteNative(`${this.root}/${relativePath}`, entry.type === 'directory')
    }
    this.directories.clear()
    this.folders.clear()
    if (options?.initialize !== false) await this.initialize()
  }

  private async deleteNative(remotePath: string, collection: boolean) {
    const encodedPath = remotePath
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    const response = await fetch(`${this.endpoint.replace(/\/$/, '')}/${encodedPath}${collection ? '/' : ''}`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}` },
    })
    if (response.status === 401) await this.client.deleteFile(`/${remotePath}`)
    else if (response.status !== 404 && !response.ok) {
      const detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 300)
      throw Object.assign(
        new Error(`WebDAV item deletion failed: ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`),
        { status: response.status },
      )
    }
  }

  private relativePath(filename: string) {
    const absolute = filename.replace(/^\/+|\/+$/g, '')
    if (absolute === this.root) return ''
    if (!absolute.startsWith(`${this.root}/`)) throw new Error('WebDAV listing returned an item outside the configured folder')
    return absolute.slice(this.root.length + 1)
  }

  private fileStat(relativePath: string) {
    return this.client.stat(this.remotePath(relativePath)) as Promise<FileStat>
  }

  private remotePath(relativePath: string) {
    const segments = relativePath.split('/')
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
      throw new Response('invalid path', { status: 400 })
    return `/${[this.root, relativePath].filter(Boolean).join('/')}`
  }

  private async ensureParent(relativePath: string) {
    const parent = relativePath.split('/').slice(0, -1).join('/')
    if (parent) await this.createFolder(parent)
  }

  private async moveByStreaming(sourcePath: string, destinationPath: string, sourceSize: number) {
    const [source, destination] = await Promise.all([this.stat(sourcePath), this.stat(destinationPath)])
    if (!source && destination?.size === sourceSize) return
    if (!source) throw assetMissingError(sourcePath)
    if (destination && destination.size !== source.size) throw new Error(`asset destination already exists: ${destinationPath}`)
    if (!destination) {
      await this.uploadStream(
        destinationPath,
        Readable.toWeb(this.client.createReadStream(this.remotePath(sourcePath))) as ReadableStream,
        source.size,
        false,
      )
    }
    await this.remove(sourcePath)
  }

  private async createFolder(relativePath: string) {
    const remotePath = this.remotePath(relativePath)
    let request = this.folders.get(remotePath)
    if (!request) {
      request = this.createDirectories(remotePath)
      this.folders.set(remotePath, request)
    }
    try {
      await request
    } catch (error) {
      this.folders.delete(remotePath)
      throw error
    }
  }

  private async createDirectories(remotePath: string) {
    let directory = ''
    for (const segment of remotePath.split('/').filter(Boolean)) {
      directory += `/${segment}`
      if (this.directories.has(directory)) continue
      const collectionPath = `${directory}/`
      try {
        const stat = (await this.client.stat(collectionPath)) as FileStat
        if (stat.type !== 'directory') throw new Error(`path includes a file: ${directory}`)
        this.directories.add(directory)
        continue
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
      try {
        await this.client.createDirectory(collectionPath)
      } catch (error) {
        if ((error as WebDAVClientError).status !== 405) throw error
      }
      this.directories.add(directory)
    }
  }

  private async getCapabilities() {
    if (this.capabilities) return this.capabilities
    const { compliance, server } = await this.client.getDAVCompliance(`/${this.root}/`)
    this.capabilities = {
      partialUpdateMode: compliance.includes('sabredav-partialupdate')
        ? 'sabredav'
        : compliance.includes(APACHE_PARTIAL_UPDATE)
          ? 'apache'
          : undefined,
      cloudflare: server.toLowerCase().includes('cloudflare'),
    }
    return this.capabilities
  }

  private async partialUpdate(remotePath: string, start: number, end: number, chunk: Buffer, mode: PartialUpdateMode) {
    if (mode === 'sabredav') return await this.client.partialUpdateFileContents(remotePath, start, end, chunk)
    await this.client.customRequest(remotePath, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(chunk.byteLength),
        'Content-Range': `bytes ${start}-${end}/*`,
      },
      data: chunk,
    })
  }
}

function cleanRoot(root: string) {
  const cleaned = root.trim().replace(/^\/+|\/+$/g, '')
  if (hasTraversalSegment(cleaned)) throw new Response('invalid path', { status: 400 })
  return cleaned
}

function isNotFound(error: unknown) {
  return (error as WebDAVClientError).status === 404
}
