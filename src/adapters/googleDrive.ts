import crypto from 'node:crypto'
import type { CloudStorageCredentials } from '../core/auth'
import type { AssetStore } from '../core/types'
import { assertRelativeStoragePath } from '../core/storagePath'
import { cloudFetch, cloudRequestError, waitForCloudRetry } from './cloudFetch'
import { cleanCloudRoot, cloudFileName, joinCloudPath } from './cloudPath'
import { OAuthAccessTokenCache, refreshOAuthAccessToken } from './oauthAccessToken'
import { assertStreamSize, streamChunks } from './streamChunks'
import { AssetStoreKeys } from './assetStoreKeys'
import { StorageInventoryBuilder } from './storageInventory'
import { assetMissingError } from './missingFile'
import { prepareAssetMove } from './assetMove'
import { verifyWritableAssetStore } from './writableAssetStore'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const TOKEN = 'https://oauth2.googleapis.com/token'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

type DriveFile = { id: string; name: string; mimeType: string; size?: string; parents?: string[] }

export class GoogleDriveAssetStore extends AssetStoreKeys implements AssetStore {
  private tokens = new OAuthAccessTokenCache()
  private baseFolder?: Promise<string>
  private folderIds = new Map<string, string>()
  private root: string

  constructor(
    root: string,
    private connection: CloudStorageCredentials,
  ) {
    super()
    this.root = cleanCloudRoot(root, 'Google Drive')
  }

  async initialize() {
    await this.initializeStorageScaffold((folder) => this.folderId(folder, true))
  }

  async write(relativePath: string, bytes: Uint8Array) {
    const parentId = await this.parentId(relativePath, true)
    const existing = await this.file(relativePath)
    const boundary = `stlquest-${crypto.randomUUID()}`
    const metadata = JSON.stringify({ name: cloudFileName(relativePath), ...(existing ? {} : { parents: [parentId] }) })
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
      body: JSON.stringify({ name: cloudFileName(relativePath), ...(existing ? {} : { parents: [parentId] }) }),
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
    assertStreamSize(offset, size, relativePath)
  }

  async read(relativePath: string) {
    const file = await this.file(relativePath)
    if (!file) throw assetMissingError(relativePath)
    const response = await this.request(`${API}/files/${encodeURIComponent(file.id)}?alt=media`, { method: 'GET', headers: {} })
    if (!response.body) throw new Error(`empty Google Drive response: ${relativePath}`)
    return { stream: response.body, size: Number(file.size ?? response.headers.get('content-length') ?? 0) }
  }

  async stat(relativePath: string) {
    const file = await this.file(relativePath)
    return file ? { size: Number(file.size ?? 0) } : undefined
  }

  async ensureMoved(sourcePath: string, destinationPath: string) {
    const move = await prepareAssetMove(
      sourcePath,
      destinationPath,
      (path) => this.file(path),
      (asset) => Number(asset.size ?? 0),
    )
    if (!move) return
    const { source, destination } = move
    if (destination) return this.deleteFile(source.id)
    const sourceParent = await this.parentId(sourcePath, false)
    const destinationParent = await this.parentId(destinationPath, true)
    const query = new URLSearchParams({ addParents: destinationParent, removeParents: sourceParent, fields: 'id,size' })
    await this.request(`${API}/files/${encodeURIComponent(source.id)}?${query}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: cloudFileName(destinationPath) }),
    })
  }

  async exists(relativePath: string) {
    return !!(await this.file(relativePath))
  }

  async remove(relativePath: string) {
    const file = await this.file(relativePath)
    if (file) await this.deleteFile(file.id)
  }

  async removeEmptyDirectory(relativePath: string) {
    const folder = await this.folder(relativePath)
    if (!folder) return true
    if ((await this.list(`'${folder.id}' in parents and trashed=false`)).length > 0) return false
    await this.deleteFile(folder.id)
    return true
  }

  async sweepTrash() {
    const trash = await this.folder('.stlquest/trash')
    if (trash) await this.deleteFile(trash.id)
    this.folderIds.delete(this.fullFolderPath('.stlquest/trash'))
    await this.folderId('.stlquest/trash', true)
  }

  async writable() {
    await verifyWritableAssetStore({
      write: (path, bytes) => this.write(path, bytes),
      read: (path) => this.read(path),
      remove: (path) => this.remove(path),
    })
  }

  async inventory() {
    const root = await this.folderId('', false)
    const inventory = new StorageInventoryBuilder()
    const visit = async (parent: string, relative = ''): Promise<void> => {
      for (const entry of await this.list(`'${parent}' in parents and trashed=false`)) {
        const child = [relative, entry.name].filter(Boolean).join('/')
        if (entry.mimeType === FOLDER_MIME) {
          inventory.addFolder(child)
          await visit(entry.id, child)
        } else {
          inventory.addFile(child, Number(entry.size ?? 0))
        }
      }
    }
    await visit(root)
    return inventory.result()
  }

  async clear(options?: { initialize?: boolean }) {
    const folder = await this.folder('')
    if (folder) await this.deleteFile(folder.id)
    this.folderIds.clear()
    if (options?.initialize !== false) await this.initialize()
  }

  private async file(relativePath: string) {
    const parent = await this.parentId(relativePath, false).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!parent) return undefined
    return this.find(parent, cloudFileName(relativePath), false)
  }

  private async folder(relativePath: string) {
    const segments = this.fullFolderPath(relativePath).split('/').filter(Boolean)
    if (!segments.length) return { id: await this.rootFolderId(), name: 'STL Quest', mimeType: FOLDER_MIME }
    const name = segments.pop()!
    const parent = await this.resolveFolders(segments, false).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    return parent ? this.find(parent, name, true) : undefined
  }

  private parentId(relativePath: string, create: boolean) {
    this.validateFilePath(relativePath)
    return this.folderId(relativePath.split('/').slice(0, -1).join('/'), create)
  }

  private folderId(relativePath: string, create: boolean) {
    return this.resolveFolders(this.fullFolderPath(relativePath).split('/').filter(Boolean), create)
  }

  private fullFolderPath(relativePath: string) {
    assertRelativeStoragePath(relativePath, true)
    return joinCloudPath(this.root, relativePath)
  }

  private validateFilePath(relativePath: string) {
    assertRelativeStoragePath(relativePath)
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
    const current = await this.list("appProperties has { key='stlQuestRoot' and value='true' } and trashed=false")
    if (current[0]) return current[0].id
    const response = await this.request(`${API}/files?fields=id,name,mimeType`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'STL Quest', mimeType: FOLDER_MIME, parents: ['root'], appProperties: { stlQuestRoot: 'true' } }),
    })
    return ((await response.json()) as DriveFile).id
  }

  private async find(parentId: string, name: string, folder: boolean) {
    const escaped = name.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
    const query = `'${parentId}' in parents and name='${escaped}' and mimeType${folder ? '=' : '!='}'${FOLDER_MIME}' and trashed=false`
    return (await this.list(query))[0]
  }

  private async list(query: string) {
    const files: DriveFile[] = []
    let pageToken: string | undefined
    do {
      const search = new URLSearchParams({
        q: query,
        spaces: 'drive',
        fields: 'nextPageToken,files(id,name,mimeType,size,parents)',
        pageSize: '1000',
        ...(pageToken ? { pageToken } : {}),
      })
      const response = await this.request(`${API}/files?${search}`, { method: 'GET', headers: {} })
      const page = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string }
      files.push(...(page.files ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)
    return files
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
      const response = await cloudFetch(url, {
        method: init.method,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
        body,
      })
      if (response.ok || (init.allowIncomplete && response.status === 308)) return response
      const error = await googleDriveError(response)
      if (!error.retryable || attempt === 5) throw error
      await waitForCloudRetry(attempt)
    }
  }

  private async token() {
    return this.tokens.get(() => this.refreshToken())
  }

  private async refreshToken() {
    if (!this.connection.clientId || !this.connection.clientSecret || !this.connection.refreshToken)
      throw new Error('Google Drive is not connected')
    return refreshOAuthAccessToken(TOKEN, {
      parameters: {
        client_id: this.connection.clientId,
        client_secret: this.connection.clientSecret,
        refresh_token: this.connection.refreshToken,
        grant_type: 'refresh_token',
      },
      fetch: cloudFetch,
      error: googleDriveError,
    })
  }
}

async function googleDriveError(response: Response) {
  return cloudRequestError('Google Drive', response, (body) => ({
    retryable: response.status === 429 || response.status >= 500 || body.includes('rateLimitExceeded'),
  }))
}
