import crypto from 'node:crypto'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import type { GoogleDriveConnectionConfig } from '../core/auth'
import { createAssetKey, destinationKey, previewKey, trashKey } from '../core/assetKeys'
import type { AssetStore } from '../core/types'
import { workflow } from '../core/workflow'
import { streamChunks } from './streamChunks'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const TOKEN = 'https://oauth2.googleapis.com/token'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

type DriveFile = { id: string; name: string; mimeType: string; size?: string; parents?: string[] }

export class GoogleDriveAssetStore implements AssetStore {
  private accessToken?: { value: string; expiresAt: number }
  private tokenRefresh?: Promise<string>
  private baseFolder?: Promise<string>
  private folderIds = new Map<string, string>()
  private root: string

  constructor(
    root: string,
    private connection: GoogleDriveConnectionConfig,
  ) {
    this.root = cleanRoot(root, 'Google Drive')
  }

  async initialize() {
    for (const folder of [
      ...workflow.statuses.map((status) => status.folder),
      '.printhub/previews',
      '.printhub/thumbnails',
      '.printhub/trash',
    ]) {
      await this.folderId(folder, true)
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
    const parentId = await this.parentId(relativePath, true)
    const existing = await this.file(relativePath)
    const boundary = `printhub-${crypto.randomUUID()}`
    const metadata = JSON.stringify({ name: fileName(relativePath), ...(existing ? {} : { parents: [parentId] }) })
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from(bytes),
      Buffer.from(`\r\n--${boundary}--`),
    ])
    const route = existing ? `/files/${existing.id}` : '/files'
    await this.request(`${UPLOAD}${route}?uploadType=multipart&fields=id,size`, {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    })
  }

  async writeStream(relativePath: string, stream: ReadableStream, size: number) {
    if (size === 0) return this.write(relativePath, new Uint8Array())
    const parentId = await this.parentId(relativePath, true)
    const existing = await this.file(relativePath)
    const route = existing ? `/files/${existing.id}` : '/files'
    const session = await this.request(`${UPLOAD}${route}?uploadType=resumable&fields=id,size`, {
      method: existing ? 'PATCH' : 'POST',
      headers: {
        'content-type': 'application/json',
        'x-upload-content-type': 'application/octet-stream',
        'x-upload-content-length': String(size),
      },
      body: JSON.stringify({ name: fileName(relativePath), ...(existing ? {} : { parents: [parentId] }) }),
    })
    const uploadUrl = session.headers.get('location')
    if (!uploadUrl) throw new Error('Google Drive did not return a resumable upload URL')
    let offset = 0
    for await (const chunk of streamChunks(stream, UPLOAD_CHUNK_BYTES)) {
      const end = offset + chunk.byteLength - 1
      const response = await this.request(uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', 'content-range': `bytes ${offset}-${end}/${size}` },
        body: Buffer.from(chunk),
        allowIncomplete: end + 1 < size,
      })
      if (end + 1 < size && response.status !== 308)
        throw new Error(`Google Drive ended an upload before all bytes were sent: ${relativePath}`)
      offset = end + 1
    }
    if (offset !== size) throw new Error(`asset size changed while copying: ${relativePath}`)
  }

  async read(relativePath: string) {
    const file = await this.file(relativePath)
    if (!file) throw Object.assign(new Error(`asset missing: ${relativePath}`), { code: 'ENOENT' })
    const response = await this.request(`${API}/files/${encodeURIComponent(file.id)}?alt=media`, { method: 'GET', headers: {} })
    if (!response.body) throw new Error(`empty Google Drive response: ${relativePath}`)
    return { stream: response.body, size: Number(file.size ?? response.headers.get('content-length') ?? 0) }
  }

  async stat(relativePath: string) {
    const file = await this.file(relativePath)
    return file ? { size: Number(file.size ?? 0) } : undefined
  }

  async move(relativePath: string, statusId: string) {
    const next = this.destinationPath(relativePath, statusId)
    await this.ensureMoved(relativePath, next)
    return next
  }

  async ensureMoved(sourcePath: string, destinationPath: string) {
    if (sourcePath === destinationPath) return
    const [source, destination] = await Promise.all([this.file(sourcePath), this.file(destinationPath)])
    if (!source && destination) return
    if (!source) throw Object.assign(new Error(`asset missing: ${sourcePath}`), { code: 'ENOENT' })
    if (destination && Number(destination.size ?? 0) !== Number(source.size ?? 0))
      throw new Error(`asset destination already exists: ${destinationPath}`)
    if (destination) return this.deleteFile(source.id)
    const sourceParent = await this.parentId(sourcePath, false)
    const destinationParent = await this.parentId(destinationPath, true)
    const query = new URLSearchParams({ addParents: destinationParent, removeParents: sourceParent, fields: 'id,size' })
    await this.request(`${API}/files/${encodeURIComponent(source.id)}?${query}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: fileName(destinationPath) }),
    })
  }

  async exists(relativePath: string) {
    return !!(await this.file(relativePath))
  }

  async remove(relativePath: string) {
    const file = await this.file(relativePath)
    if (file) await this.deleteFile(file.id)
  }

  async trash(relativePath: string) {
    if (!(await this.file(relativePath))) return undefined
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
    const trash = await this.folder('.printhub/trash')
    if (trash) await this.deleteFile(trash.id)
    this.folderIds.delete(this.fullFolderPath('.printhub/trash'))
    await this.folderId('.printhub/trash', true)
  }

  async writable() {
    const probe = `.printhub/health-${crypto.randomUUID()}`
    await this.write(probe, new Uint8Array([1]))
    const readable = await this.read(probe)
    await readable.stream.cancel()
    await this.remove(probe)
  }

  private async file(relativePath: string) {
    const parent = await this.parentId(relativePath, false).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!parent) return undefined
    return this.find(parent, fileName(relativePath), false)
  }

  private async folder(relativePath: string) {
    const segments = this.fullFolderPath(relativePath).split('/').filter(Boolean)
    if (!segments.length) return { id: await this.rootFolderId(), name: 'PrintHub', mimeType: FOLDER_MIME }
    const name = segments.pop()!
    const parent = await this.resolveFolders(segments, false).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    return parent ? this.find(parent, name, true) : undefined
  }

  private parentId(relativePath: string, create: boolean) {
    return this.folderId(relativePath.split('/').slice(0, -1).join('/'), create)
  }

  private folderId(relativePath: string, create: boolean) {
    return this.resolveFolders(this.fullFolderPath(relativePath).split('/').filter(Boolean), create)
  }

  private fullFolderPath(relativePath: string) {
    return [this.root, relativePath].filter(Boolean).join('/')
  }

  private async resolveFolders(segments: string[], create: boolean) {
    let parent = await this.rootFolderId()
    let current = ''
    for (const segment of segments) {
      current = [current, segment].filter(Boolean).join('/')
      const cached = this.folderIds.get(current)
      if (cached) {
        parent = cached
        continue
      }
      let folder = await this.find(parent, segment, true)
      if (!folder && create) folder = await this.createFolder(parent, segment)
      if (!folder) throw Object.assign(new Error(`Google Drive folder missing: ${current}`), { code: 'ENOENT' })
      this.folderIds.set(current, folder.id)
      parent = folder.id
    }
    return parent
  }

  private rootFolderId() {
    this.baseFolder ??= this.findRootFolder()
    return this.baseFolder
  }

  private async findRootFolder() {
    const query = "appProperties has { key='printhubRoot' and value='true' } and trashed=false"
    const existing = await this.list(query)
    if (existing[0]) return existing[0].id
    const response = await this.request(`${API}/files?fields=id,name,mimeType`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'PrintHub', mimeType: FOLDER_MIME, parents: ['root'], appProperties: { printhubRoot: 'true' } }),
    })
    return ((await response.json()) as DriveFile).id
  }

  private async find(parentId: string, name: string, folder: boolean) {
    const escaped = name.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
    const query = `'${parentId}' in parents and name='${escaped}' and mimeType${folder ? '=' : '!='}'${FOLDER_MIME}' and trashed=false`
    return (await this.list(query))[0]
  }

  private async list(query: string) {
    const search = new URLSearchParams({ q: query, spaces: 'drive', fields: 'files(id,name,mimeType,size,parents)', pageSize: '2' })
    const response = await this.request(`${API}/files?${search}`, { method: 'GET', headers: {} })
    return ((await response.json()) as { files?: DriveFile[] }).files ?? []
  }

  private async createFolder(parentId: string, name: string) {
    const response = await this.request(`${API}/files?fields=id,name,mimeType`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    })
    return (await response.json()) as DriveFile
  }

  private async deleteFile(id: string) {
    try {
      await this.request(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: {} })
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error
    }
  }

  private async request(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string | Buffer; allowIncomplete?: boolean },
  ) {
    const token = await this.token()
    const body = typeof init.body === 'string' ? init.body : init.body ? new Uint8Array(init.body) : undefined
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, {
        method: init.method,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
        body,
      })
      if (response.ok || (init.allowIncomplete && response.status === 308)) return response
      const error = await googleDriveError(response)
      if (!error.retryable || attempt === 5) throw error
      await wait(Math.min(250 * 2 ** attempt, 4_000))
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
      throw new Error('Google Drive is not connected')
    const response = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.connection.clientId,
        client_secret: this.connection.clientSecret,
        refresh_token: this.connection.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    if (!response.ok) throw await googleDriveError(response)
    const token = (await response.json()) as { access_token: string; expires_in: number }
    this.accessToken = { value: token.access_token, expiresAt: Date.now() + Math.max(token.expires_in - 60, 1) * 1_000 }
    return token.access_token
  }
}

function cleanRoot(root: string, provider: string) {
  const cleaned = root.trim().replace(/^\/+|\/+$/g, '')
  if (cleaned.split('/').some((segment) => segment === '.' || segment === '..'))
    throw new Response(`invalid ${provider} folder`, { status: 400 })
  return cleaned
}

function fileName(relativePath: string) {
  return relativePath.split('/').pop()!
}

async function googleDriveError(response: Response) {
  const body = await response.text()
  return Object.assign(new Error(`Google Drive request failed (${response.status}): ${body}`), {
    status: response.status,
    body,
    retryable: response.status === 429 || response.status >= 500 || body.includes('rateLimitExceeded'),
    $metadata: { httpStatusCode: response.status },
  })
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
