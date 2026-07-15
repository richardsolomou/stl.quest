import crypto from 'node:crypto'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import type { OneDriveConnectionConfig } from '../core/auth'
import { createAssetKey, destinationKey, previewKey, trashKey } from '../core/assetKeys'
import type { AssetStore } from '../core/types'
import { workflow } from '../core/workflow'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024

type DriveItem = { id: string; name: string; size?: number; folder?: Record<string, unknown>; parentReference?: { id?: string } }

export class OneDriveAssetStore implements AssetStore {
  private accessToken?: { value: string; expiresAt: number }
  private tokenRefresh?: Promise<string>
  private root: string

  constructor(
    root: string,
    private connection: OneDriveConnectionConfig,
    private updateRefreshToken?: (refreshToken: string) => void,
  ) {
    this.root = cleanRoot(root)
  }

  async initialize() {
    await this.rootItem(true)
    for (const folder of [
      ...workflow.statuses.map((status) => status.folder),
      '.printhub/previews',
      '.printhub/thumbnails',
      '.printhub/trash',
    ]) {
      await this.folderItem(folder, true)
    }
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
    await this.parentItem(relativePath, true)
    await this.request(`${this.itemUrl(relativePath)}:/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    })
  }

  async writeStream(relativePath: string, stream: ReadableStream, size: number) {
    if (size === 0) return this.write(relativePath, new Uint8Array())
    await this.parentItem(relativePath, true)
    const sessionResponse = await this.request(`${this.itemUrl(relativePath)}:/createUploadSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace', name: fileName(relativePath) } }),
    })
    const session = (await sessionResponse.json()) as { uploadUrl?: string }
    if (!session.uploadUrl) throw new Error('OneDrive did not return a resumable upload URL')
    let offset = 0
    for await (const chunk of streamChunks(stream, UPLOAD_CHUNK_BYTES)) {
      const end = offset + chunk.byteLength - 1
      const response = await requestUploadSession(session.uploadUrl, chunk, offset, end, size)
      if (end + 1 < size && response.status !== 202) throw new Error(`OneDrive ended an upload before all bytes were sent: ${relativePath}`)
      offset = end + 1
    }
    if (offset !== size) throw new Error(`asset size changed while copying: ${relativePath}`)
  }

  async read(relativePath: string) {
    const item = await this.item(relativePath)
    if (!item) throw Object.assign(new Error(`asset missing: ${relativePath}`), { code: 'ENOENT' })
    const response = await this.request(`${this.itemUrl(relativePath)}:/content`, { method: 'GET', headers: {} })
    if (!response.body) throw new Error(`empty OneDrive response: ${relativePath}`)
    return { stream: response.body, size: item.size ?? Number(response.headers.get('content-length') ?? 0) }
  }

  async stat(relativePath: string) {
    const item = await this.item(relativePath)
    return item && !item.folder ? { size: item.size ?? 0 } : undefined
  }

  async move(relativePath: string, statusId: string) {
    const next = this.destinationPath(relativePath, statusId)
    await this.ensureMoved(relativePath, next)
    return next
  }

  async ensureMoved(sourcePath: string, destinationPath: string) {
    if (sourcePath === destinationPath) return
    const [source, destination] = await Promise.all([this.item(sourcePath), this.item(destinationPath)])
    if (!source && destination) return
    if (!source) throw Object.assign(new Error(`asset missing: ${sourcePath}`), { code: 'ENOENT' })
    if (destination && destination.size !== source.size) throw new Error(`asset destination already exists: ${destinationPath}`)
    if (destination) return this.deleteItem(source.id)
    const parent = await this.parentItem(destinationPath, true)
    await this.request(`${GRAPH}/me/drive/items/${encodeURIComponent(source.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: fileName(destinationPath), parentReference: { id: parent.id } }),
    })
  }

  async exists(relativePath: string) {
    return !!(await this.item(relativePath))
  }

  async remove(relativePath: string) {
    const item = await this.item(relativePath)
    if (item) await this.deleteItem(item.id)
  }

  async trash(relativePath: string) {
    if (!(await this.item(relativePath))) return undefined
    const next = `.printhub/trash/${crypto.randomUUID()}__${fileName(relativePath)}`
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
    const trash = await this.folderItem('.printhub/trash', false).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (trash) await this.deleteItem(trash.id)
    await this.folderItem('.printhub/trash', true)
  }

  async writable() {
    const probe = `.printhub/health-${crypto.randomUUID()}`
    await this.write(probe, new Uint8Array([1]))
    const readable = await this.read(probe)
    await readable.stream.cancel()
    await this.remove(probe)
  }

  private async rootItem(create: boolean) {
    const appRoot = await this.requestItem(`${GRAPH}/me/drive/special/approot`)
    if (!appRoot) throw new Error('OneDrive app folder is unavailable')
    let parent = appRoot
    for (const segment of this.root.split('/').filter(Boolean)) {
      const next = await this.requestItem(this.itemUrlFrom(parent, segment))
      if (next) parent = next
      else if (create) parent = await this.createFolder(parent, segment)
      else throw Object.assign(new Error(`OneDrive folder missing: ${this.root}`), { code: 'ENOENT' })
    }
    return parent
  }

  private async parentItem(relativePath: string, create: boolean) {
    return this.folderItem(relativePath.split('/').slice(0, -1).join('/'), create)
  }

  private async folderItem(relativePath: string, create: boolean) {
    let parent = await this.rootItem(create)
    for (const segment of relativePath.split('/').filter(Boolean)) {
      const next = await this.requestItem(this.itemUrlFrom(parent, segment))
      if (next?.folder) parent = next
      else if (create && !next) parent = await this.createFolder(parent, segment)
      else throw Object.assign(new Error(`OneDrive folder missing: ${relativePath}`), { code: 'ENOENT' })
    }
    return parent
  }

  private item(relativePath: string) {
    return this.requestItem(this.itemUrl(relativePath))
  }

  private async requestItem(url: string) {
    try {
      const response = await this.request(url, { method: 'GET', headers: {} })
      return (await response.json()) as DriveItem
    } catch (error) {
      if ((error as { status?: number }).status === 404) return undefined
      throw error
    }
  }

  private async createFolder(parent: DriveItem, name: string) {
    const response = await this.request(`${GRAPH}/me/drive/items/${encodeURIComponent(parent.id)}/children`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    })
    return (await response.json()) as DriveItem
  }

  private itemUrl(relativePath: string) {
    const path = [this.root, relativePath].filter(Boolean).join('/')
    return path ? `${GRAPH}/me/drive/special/approot:/${encodePath(path)}` : `${GRAPH}/me/drive/special/approot`
  }

  private itemUrlFrom(parent: DriveItem, name: string) {
    return `${GRAPH}/me/drive/items/${encodeURIComponent(parent.id)}:/${encodeURIComponent(name)}`
  }

  private async deleteItem(id: string) {
    try {
      await this.request(`${GRAPH}/me/drive/items/${encodeURIComponent(id)}`, { method: 'DELETE', headers: {} })
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error
    }
  }

  private async request(url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }) {
    const token = await this.token()
    const body = typeof init.body === 'string' ? init.body : init.body ? new Uint8Array(init.body) : undefined
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, { method: init.method, headers: { ...init.headers, authorization: `Bearer ${token}` }, body })
      if (response.ok) return response
      const error = await oneDriveError(response)
      if (!error.retryable || attempt === 5) throw error
      await wait(error.retryAfterMs || Math.min(250 * 2 ** attempt, 4_000))
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
      throw new Error('OneDrive is not connected')
    const response = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.connection.clientId,
        client_secret: this.connection.clientSecret,
        refresh_token: this.connection.refreshToken,
        grant_type: 'refresh_token',
        scope: 'offline_access User.Read Files.ReadWrite',
      }),
    })
    if (!response.ok) throw await oneDriveError(response)
    const token = (await response.json()) as { access_token: string; expires_in: number; refresh_token?: string }
    if (token.refresh_token && token.refresh_token !== this.connection.refreshToken) {
      this.connection.refreshToken = token.refresh_token
      this.updateRefreshToken?.(token.refresh_token)
    }
    this.accessToken = { value: token.access_token, expiresAt: Date.now() + Math.max(token.expires_in - 60, 1) * 1_000 }
    return token.access_token
  }
}

function cleanRoot(root: string) {
  const cleaned = root.trim().replace(/^\/+|\/+$/g, '')
  if (cleaned.split('/').some((segment) => segment === '.' || segment === '..'))
    throw new Response('invalid OneDrive folder', { status: 400 })
  return cleaned
}

function fileName(relativePath: string) {
  return relativePath.split('/').pop()!
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

async function* streamChunks(stream: ReadableStream, limit: number) {
  const reader = stream.getReader()
  let buffered = Buffer.alloc(0)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffered = Buffer.concat([buffered, Buffer.from(value)])
      while (buffered.byteLength >= limit) {
        yield buffered.subarray(0, limit)
        buffered = buffered.subarray(limit)
      }
    }
    if (buffered.byteLength) yield buffered
  } finally {
    reader.releaseLock()
  }
}

async function requestUploadSession(url: string, chunk: Uint8Array, start: number, end: number, total: number) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'content-length': String(chunk.byteLength), 'content-range': `bytes ${start}-${end}/${total}` },
      body: new Uint8Array(chunk),
    })
    if (response.ok) return response
    const error = await oneDriveError(response)
    if (!error.retryable || attempt === 5) throw error
    await wait(error.retryAfterMs || Math.min(250 * 2 ** attempt, 4_000))
  }
}

async function oneDriveError(response: Response) {
  const body = await response.text()
  const retryAfter = Number(response.headers.get('retry-after') ?? 0)
  return Object.assign(new Error(`OneDrive request failed (${response.status}): ${body}`), {
    status: response.status,
    body,
    retryable: response.status === 429 || response.status >= 500,
    retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0,
    $metadata: { httpStatusCode: response.status },
  })
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
