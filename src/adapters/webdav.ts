import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { AuthType, createClient, type FileStat, type WebDAVClient, type WebDAVClientError } from 'webdav'
import { createAssetKey, destinationKey, previewKey, trashKey } from '../core/assetKeys'
import type { AssetStore, StorageConfig } from '../core/types'
import { workflow } from '../core/workflow'

type WebDAVConfig = Extract<StorageConfig, { adapter: 'webdav' }>

export class WebDAVAssetStore implements AssetStore {
  private folders = new Map<string, Promise<void>>()
  private root: string
  private client: WebDAVClient

  constructor(config: WebDAVConfig, client?: WebDAVClient) {
    this.root = cleanRoot(config.root)
    this.client = client ?? createClient(config.endpoint, { authType: AuthType.Auto, username: config.username, password: config.password })
  }

  async initialize() {
    const folders = [...workflow.statuses.map((status) => status.folder), '.stlquest/previews', '.stlquest/thumbnails', '.stlquest/trash']
    for (const folder of folders) await this.createFolder(folder)
  }

  createPath(originalFileName: string) {
    return createAssetKey(originalFileName)
  }

  previewPath(originalRelativePath: string) {
    return previewKey(originalRelativePath)
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
    if (!staged) throw Object.assign(new Error(`upload part missing: ${stagedPath}`), { code: 'ENOENT' })
    if (destination) {
      if (destination.size !== staged.size) throw new Error(`upload destination already exists: ${relativePath}`)
    } else {
      await this.ensureParent(relativePath)
      await this.client.putFileContents(this.remotePath(relativePath), fs.createReadStream(stagedPath), {
        contentLength: staged.size,
        overwrite: false,
      })
    }
    await fs.promises.rm(stagedPath, { force: true })
  }

  async write(relativePath: string, bytes: Uint8Array) {
    await this.ensureParent(relativePath)
    await this.client.putFileContents(this.remotePath(relativePath), Buffer.from(bytes), { overwrite: true })
  }

  async writeStream(relativePath: string, stream: ReadableStream, size: number) {
    await this.ensureParent(relativePath)
    await this.client.putFileContents(this.remotePath(relativePath), Readable.fromWeb(stream as import('node:stream/web').ReadableStream), {
      contentLength: size,
      overwrite: true,
    })
  }

  async read(relativePath: string) {
    const stat = await this.fileStat(relativePath)
    return {
      stream: Readable.toWeb(this.client.createReadStream(this.remotePath(relativePath))) as ReadableStream,
      size: stat.size,
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

  async move(relativePath: string, statusId: string) {
    const next = this.destinationPath(relativePath, statusId)
    await this.ensureMoved(relativePath, next)
    return next
  }

  async ensureMoved(sourcePath: string, destinationPath: string) {
    if (sourcePath === destinationPath) return
    const [source, destination] = await Promise.all([this.stat(sourcePath), this.stat(destinationPath)])
    if (!source && destination) return
    if (!source) throw Object.assign(new Error(`asset missing: ${sourcePath}`), { code: 'ENOENT' })
    if (destination && destination.size !== source.size) throw new Error(`asset destination already exists: ${destinationPath}`)
    if (destination) return this.remove(sourcePath)
    await this.ensureParent(destinationPath)
    await this.client.moveFile(this.remotePath(sourcePath), this.remotePath(destinationPath), { overwrite: false })
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

  async trash(relativePath: string) {
    if (!(await this.stat(relativePath))) return undefined
    const next = `.stlquest/trash/${crypto.randomUUID()}__${path.posix.basename(relativePath)}`
    await this.ensureMoved(relativePath, next)
    return next
  }

  async purgeTrash(trashPath: string) {
    await this.remove(trashPath)
  }

  destinationPath(relativePath: string, statusId: string) {
    return destinationKey(relativePath, statusId)
  }

  trashPath(operationId: string, relativePath: string) {
    return trashKey(operationId, relativePath)
  }

  async sweepTrash() {
    await this.remove('.stlquest/trash')
    this.folders.delete(this.remotePath('.stlquest/trash'))
    await this.createFolder('.stlquest/trash')
  }

  async writable() {
    const probe = `.stlquest/health-${crypto.randomUUID()}`
    await this.write(probe, new Uint8Array())
    await this.remove(probe)
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

  private async createFolder(relativePath: string) {
    const remotePath = this.remotePath(relativePath)
    let request = this.folders.get(remotePath)
    if (!request) {
      request = this.client.createDirectory(remotePath, { recursive: true })
      this.folders.set(remotePath, request)
    }
    try {
      await request
    } catch (error) {
      this.folders.delete(remotePath)
      throw error
    }
  }
}

function cleanRoot(root: string) {
  const cleaned = root.trim().replace(/^\/+|\/+$/g, '')
  if (cleaned.split('/').some((segment) => segment === '.' || segment === '..')) throw new Response('invalid path', { status: 400 })
  return cleaned
}

function isNotFound(error: unknown) {
  return (error as WebDAVClientError).status === 404
}
