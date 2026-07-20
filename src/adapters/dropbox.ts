import crypto from 'node:crypto'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import type { DropboxConnectionConfig } from '../core/auth'
import { createAssetKey, destinationKey, previewKey, trashKey } from '../core/assetKeys'
import type { AssetStore } from '../core/types'
import { workflow } from '../core/workflow'
import { cloudFetch } from './cloudFetch'
import { streamChunks } from './streamChunks'

const API = 'https://api.dropboxapi.com/2'
const CONTENT = 'https://content.dropboxapi.com/2'
const TOKEN = 'https://api.dropboxapi.com/oauth2/token'
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

type DropboxMetadata = { '.tag': 'file' | 'folder'; path_display?: string; size?: number }

export class DropboxAssetStore implements AssetStore {
  private accessToken?: { value: string; expiresAt: number }
  private tokenRefresh?: Promise<string>
  private folders = new Map<string, Promise<void>>()
  private root: string

  constructor(
    root: string,
    private connection: DropboxConnectionConfig,
  ) {
    this.root = cleanRoot(root)
  }

  async initialize() {
    const folders = [...workflow.statuses.map((status) => status.folder), '.printhub/previews', '.printhub/thumbnails', '.printhub/trash']
    for (const folder of folders) await this.createFolder(folder)
  }

  createPath(originalFileName: string) {
    return createAssetKey(originalFileName)
  }

  previewPath(originalRelativePath: string) {
    return previewKey(originalRelativePath)
  }

  async finalizeUpload(stagedPath: string, relativePath: string) {
    const source = await fs.promises.stat(stagedPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    const destination = await this.stat(relativePath)
    if (!source && destination) return
    if (!source) throw Object.assign(new Error(`upload part missing: ${stagedPath}`), { code: 'ENOENT' })
    if (destination) {
      if (destination.size !== source.size) throw new Error(`upload destination already exists: ${relativePath}`)
      await fs.promises.rm(stagedPath, { force: true })
      return
    }
    await this.writeStream(relativePath, Readable.toWeb(fs.createReadStream(stagedPath)) as ReadableStream, source.size)
    await fs.promises.unlink(stagedPath)
  }

  async write(relativePath: string, bytes: Uint8Array) {
    await this.ensureParent(relativePath)
    await this.content('/files/upload', uploadCommit(this.path(relativePath)), bytes)
  }

  async writeStream(relativePath: string, stream: ReadableStream, size: number) {
    await this.ensureParent(relativePath)
    if (size === 0) return this.write(relativePath, new Uint8Array())
    const started = await this.content<{ session_id: string }>('/files/upload_session/start', { close: false }, new Uint8Array())
    let offset = 0
    for await (const chunk of streamChunks(stream, UPLOAD_CHUNK_BYTES)) {
      await this.content('/files/upload_session/append_v2', { cursor: { session_id: started.session_id, offset }, close: false }, chunk)
      offset += chunk.byteLength
    }
    if (offset !== size) throw new Error(`asset size changed while copying: ${relativePath}`)
    await this.content(
      '/files/upload_session/finish',
      { cursor: { session_id: started.session_id, offset }, commit: uploadCommit(this.path(relativePath)) },
      new Uint8Array(),
    )
  }

  async read(relativePath: string) {
    const response = await this.contentResponse('/files/download', { path: this.path(relativePath) })
    const metadata = JSON.parse(response.headers.get('dropbox-api-result') ?? '{}') as DropboxMetadata
    if (!response.body) throw new Error(`empty Dropbox response: ${relativePath}`)
    return { stream: response.body, size: metadata.size ?? Number(response.headers.get('content-length') ?? 0) }
  }

  async stat(relativePath: string) {
    try {
      const metadata = await this.rpc<DropboxMetadata>('/files/get_metadata', { path: this.path(relativePath) })
      return metadata['.tag'] === 'file' ? { size: metadata.size ?? 0 } : undefined
    } catch (error) {
      if (isDropboxNotFound(error)) return undefined
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
    if (!destination) {
      await this.ensureParent(destinationPath)
      await this.rpc('/files/move_v2', {
        from_path: this.path(sourcePath),
        to_path: this.path(destinationPath),
        autorename: false,
        allow_ownership_transfer: false,
      })
    }
  }

  async exists(relativePath: string) {
    return !!(await this.stat(relativePath))
  }

  async remove(relativePath: string) {
    try {
      await this.rpc('/files/delete_v2', { path: this.path(relativePath) })
    } catch (error) {
      if (!isDropboxNotFound(error)) throw error
    }
  }

  async trash(relativePath: string) {
    if (!(await this.stat(relativePath))) return undefined
    const next = `.printhub/trash/${crypto.randomUUID()}__${relativePath.split('/').pop()}`
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
    await this.remove('.printhub/trash')
    await this.createFolder('.printhub/trash')
  }

  async writable() {
    const probe = `.printhub/health-${crypto.randomUUID()}`
    await this.write(probe, new Uint8Array())
    await this.remove(probe)
  }

  private path(relativePath: string) {
    const segments = relativePath.split('/')
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
      throw new Response('invalid path', { status: 400 })
    return `/${[this.root, relativePath].filter(Boolean).join('/')}`
  }

  private async ensureParent(relativePath: string) {
    const segments = relativePath.split('/').slice(0, -1)
    for (let index = 1; index <= segments.length; index++) await this.createFolder(segments.slice(0, index).join('/'))
  }

  private async createFolder(relativePath: string) {
    const segments = [...this.root.split('/').filter(Boolean), ...relativePath.split('/').filter(Boolean)]
    for (let index = 1; index <= segments.length; index++) {
      const path = `/${segments.slice(0, index).join('/')}`
      let request = this.folders.get(path)
      if (!request) {
        request = this.rpc('/files/create_folder_v2', { path, autorename: false })
          .then(() => undefined)
          .catch((error) => {
            if (!isDropboxFolderConflict(error)) throw error
          })
        this.folders.set(path, request)
      }
      try {
        await request
      } catch (error) {
        this.folders.delete(path)
        throw error
      }
    }
  }

  private async rpc<T = unknown>(route: string, body: unknown): Promise<T> {
    const response = await this.request(`${API}${route}`, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return response.json() as Promise<T>
  }

  private async content<T = unknown>(route: string, argument: unknown, body: Uint8Array): Promise<T> {
    const response = await this.contentResponse(route, argument, body)
    return response.json() as Promise<T>
  }

  private contentResponse(route: string, argument: unknown, body?: Uint8Array) {
    return this.request(`${CONTENT}${route}`, {
      headers: { 'content-type': 'application/octet-stream', 'dropbox-api-arg': dropboxArgument(argument) },
      body,
    })
  }

  private async request(url: string, init: { headers: Record<string, string>; body?: string | Uint8Array }) {
    const token = await this.token()
    const body = typeof init.body === 'string' ? init.body : init.body ? Buffer.from(init.body) : undefined
    for (let attempt = 0; ; attempt++) {
      const response = await cloudFetch(url, {
        method: 'POST',
        ...init,
        body,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      })
      if (response.ok) return response
      const error = await dropboxError(response)
      if (error.status !== 429 || attempt === 5) throw error
      await wait(Math.max(error.retryAfterMs, Math.min(250 * 2 ** attempt, 4_000)))
    }
  }

  private async token() {
    if (this.accessToken && this.accessToken.expiresAt > Date.now()) return this.accessToken.value
    this.tokenRefresh ??= this.refreshToken().finally(() => {
      this.tokenRefresh = undefined
    })
    return this.tokenRefresh
  }

  private async refreshToken() {
    if (!this.connection.clientId || !this.connection.clientSecret || !this.connection.refreshToken)
      throw new Error('Dropbox is not connected')
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.connection.refreshToken })
    const response = await cloudFetch(TOKEN, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.connection.clientId}:${this.connection.clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    if (!response.ok) throw await dropboxError(response)
    const token = (await response.json()) as { access_token: string; expires_in: number }
    this.accessToken = { value: token.access_token, expiresAt: Date.now() + Math.max(token.expires_in - 60, 1) * 1_000 }
    return token.access_token
  }
}

function cleanRoot(root: string) {
  const cleaned = root.trim().replace(/^\/+|\/+$/g, '')
  if (cleaned.split('/').some((segment) => segment === '.' || segment === '..'))
    throw new Response('invalid Dropbox folder', { status: 400 })
  return cleaned
}

function uploadCommit(path: string) {
  return { path, mode: 'overwrite', autorename: false, mute: true, strict_conflict: false }
}

function dropboxArgument(argument: unknown) {
  return JSON.stringify(argument).replace(/[\u007f-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

async function dropboxError(response: Response) {
  const body = await response.text()
  const retryAfterHeader = response.headers.get('retry-after')
  const headerRetryAfter = retryAfterHeader === null ? undefined : Number(retryAfterHeader)
  const bodyRetryAfter = Number(body.match(/"retry_after"\s*:\s*(\d+)/)?.[1])
  return Object.assign(new Error(`Dropbox request failed (${response.status}): ${body}`), {
    status: response.status,
    body,
    retryAfterMs: 1_000 * (headerRetryAfter !== undefined && Number.isFinite(headerRetryAfter) ? headerRetryAfter : bodyRetryAfter || 0),
    $metadata: { httpStatusCode: response.status },
  })
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isDropboxNotFound(error: unknown) {
  const candidate = error as { status?: number; body?: string }
  return candidate.status === 409 && candidate.body?.includes('not_found')
}

function isDropboxFolderConflict(error: unknown) {
  const candidate = error as { status?: number; body?: string }
  return candidate.status === 409 && candidate.body?.includes('conflict') && candidate.body.includes('folder')
}
