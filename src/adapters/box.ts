import crypto from 'node:crypto'
import type { CloudStorageCredentials } from '../core/auth'
import { assertRelativeStoragePath } from '../core/storagePath'
import type { AssetStore } from '../core/types'
import { prepareAssetMove } from './assetMove'
import { cloudFetch, cloudRequestError, waitForCloudRetry } from './cloudFetch'
import { cleanCloudRoot, cloudFileName, joinCloudPath } from './cloudPath'
import { assetMissingError } from './missingFile'
import { OAuthAssetStoreKeys } from './oauthAssetStoreKeys'
import { refreshOAuthAccessToken } from './oauthAccessToken'
import { assertStreamSize, streamChunks } from './streamChunks'
import { StorageInventoryBuilder } from './storageInventory'
import { verifyWritableAssetStore } from './writableAssetStore'

const API = 'https://api.box.com/2.0'
const UPLOAD = 'https://upload.box.com/api/2.0'
const TOKEN = 'https://api.box.com/oauth2/token'
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

type BoxItem = { id: string; type: 'file' | 'folder'; name: string; size?: number; parent?: { id: string } }
type UploadPart = { part_id: string; offset: number; size: number; sha1: string }

export class BoxAssetStore extends OAuthAssetStoreKeys implements AssetStore {
  private root: string

  constructor(
    root: string,
    private connection: CloudStorageCredentials,
    private updateRefreshToken?: (refreshToken: string) => void,
    private providerRoot = false,
  ) {
    super()
    this.root = cleanCloudRoot(root, 'Box')
  }

  async initialize() {
    await this.rootItem(true)
    await this.initializeStorageScaffold((folder) => this.folderItem(folder, true))
  }

  async write(relativePath: string, bytes: Uint8Array) {
    const parent = await this.parentItem(relativePath, true)
    const existing = await this.item(relativePath)
    const attributes = { name: cloudFileName(relativePath), parent: { id: parent.id } }
    const form = new FormData()
    form.set('attributes', JSON.stringify(attributes))
    form.set('file', new Blob([new Uint8Array(bytes)]), cloudFileName(relativePath))
    await this.request(existing ? `${UPLOAD}/files/${existing.id}/content` : `${UPLOAD}/files/content`, { method: 'POST', body: form })
  }

  async writeStream(relativePath: string, stream: ReadableStream, size: number) {
    if (size === 0) return this.write(relativePath, new Uint8Array())
    const parent = await this.parentItem(relativePath, true)
    const existing = await this.item(relativePath)
    const response = await this.request(existing ? `${UPLOAD}/files/${existing.id}/upload_sessions` : `${UPLOAD}/files/upload_sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        existing ? { file_size: size } : { folder_id: parent.id, file_size: size, file_name: cloudFileName(relativePath) },
      ),
    })
    const session = (await response.json()) as {
      id: string
      session_endpoints: { upload_part: string; commit: string }
      part_size?: number
    }
    const parts: UploadPart[] = []
    const wholeHash = crypto.createHash('sha1')
    let offset = 0
    for await (const chunk of streamChunks(stream, session.part_size ?? UPLOAD_CHUNK_BYTES)) {
      const bytes = new Uint8Array(chunk)
      wholeHash.update(bytes)
      const digest = crypto.createHash('sha1').update(bytes).digest('base64')
      const part = await this.request(session.session_endpoints.upload_part, {
        method: 'PUT',
        headers: { digest: `sha=${digest}`, 'content-range': `bytes ${offset}-${offset + bytes.byteLength - 1}/${size}` },
        body: bytes,
      })
      parts.push(((await part.json()) as { part: UploadPart }).part)
      offset += bytes.byteLength
    }
    assertStreamSize(offset, size, relativePath)
    const digest = wholeHash.digest('base64')
    const commit = {
      method: 'POST',
      headers: { digest: `sha=${digest}`, 'content-type': 'application/json' },
      body: JSON.stringify({ parts }),
    }
    for (let attempt = 0; ; attempt++) {
      const committed = await this.request(session.session_endpoints.commit, commit)
      if (committed.status !== 202) break
      if (attempt === 5) throw new Error(`Box did not finish committing the upload: ${relativePath}`)
      await waitForCloudRetry(attempt, { delayMs: Number(committed.headers.get('retry-after') ?? 0) * 1000 })
    }
  }

  async read(relativePath: string) {
    const item = await this.item(relativePath)
    if (!item || item.type !== 'file') throw assetMissingError(relativePath)
    const response = await this.request(`${API}/files/${item.id}/content`, { method: 'GET' })
    if (!response.body) throw new Error(`empty Box response: ${relativePath}`)
    return { stream: response.body, size: item.size ?? Number(response.headers.get('content-length') ?? 0) }
  }

  async stat(relativePath: string) {
    const item = await this.item(relativePath)
    return item?.type === 'file' ? { size: item.size ?? 0 } : undefined
  }

  async ensureMoved(sourcePath: string, destinationPath: string) {
    const move = await prepareAssetMove(
      sourcePath,
      destinationPath,
      (path) => this.item(path),
      (item) => item.size,
    )
    if (!move) return
    if (move.destination) return this.deleteItem(move.source)
    const parent = await this.parentItem(destinationPath, true)
    await this.request(`${API}/files/${move.source.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: cloudFileName(destinationPath), parent: { id: parent.id } }),
    })
  }

  async exists(relativePath: string) {
    return !!(await this.item(relativePath))
  }
  async remove(relativePath: string) {
    const item = await this.item(relativePath)
    if (item) await this.deleteItem(item)
  }

  async removeEmptyDirectory(relativePath: string) {
    const folder = await this.folderItem(relativePath, false).catch((error: NodeJS.ErrnoException) =>
      error.code === 'ENOENT' ? undefined : Promise.reject(error),
    )
    if (!folder) return true
    if ((await this.children(folder.id, 1)).length) return false
    await this.deleteItem(folder)
    return true
  }

  async sweepTrash() {
    const trash = await this.folderItem('trash', false).catch((error: NodeJS.ErrnoException) =>
      error.code === 'ENOENT' ? undefined : Promise.reject(error),
    )
    if (trash) await this.deleteItem(trash)
    await this.folderItem('trash', true)
  }

  async writable() {
    await verifyWritableAssetStore({ write: (p, b) => this.write(p, b), read: (p) => this.read(p), remove: (p) => this.remove(p) })
  }

  async inventory(options?: { maxEntries?: number }) {
    const inventory = new StorageInventoryBuilder(options?.maxEntries)
    const visit = async (parent: BoxItem, relative = ''): Promise<void> => {
      for (const entry of await this.children(parent.id)) {
        const child = [relative, entry.name].filter(Boolean).join('/')
        if (entry.type === 'folder') {
          inventory.addFolder(child)
          await visit(entry, child)
        } else inventory.addFile(child, entry.size ?? 0)
      }
    }
    await visit(await this.rootItem(false))
    return inventory.result()
  }

  async clear(options?: { initialize?: boolean }) {
    const root = await this.rootItem(false).catch((error: NodeJS.ErrnoException) =>
      error.code === 'ENOENT' ? undefined : Promise.reject(error),
    )
    if (root) await this.deleteItem(root)
    if (options?.initialize !== false) await this.initialize()
  }

  private async rootItem(create: boolean) {
    return this.resolveFolders(this.storageRoot().split('/').filter(Boolean), create)
  }
  private parentItem(path: string, create: boolean) {
    this.validatePath(path)
    return this.folderItem(path.split('/').slice(0, -1).join('/'), create)
  }
  private folderItem(path: string, create: boolean) {
    assertRelativeStoragePath(path, true)
    return this.resolveFolders(joinCloudPath(this.storageRoot(), path).split('/').filter(Boolean), create)
  }
  private async item(path: string) {
    this.validatePath(path)
    const parent = await this.parentItem(path, false).catch(() => undefined)
    return parent ? this.find(parent.id, cloudFileName(path), 'file') : undefined
  }
  private validatePath(path: string) {
    assertRelativeStoragePath(path)
  }

  private storageRoot() {
    return this.providerRoot ? this.root : joinCloudPath('STL Quest', this.root)
  }

  private async resolveFolders(segments: string[], create: boolean) {
    let parent: BoxItem = { id: '0', type: 'folder', name: '' }
    for (const name of segments) {
      const existing = await this.find(parent.id, name, 'folder')
      if (existing) parent = existing
      else if (create) parent = await this.createFolder(parent.id, name)
      else throw Object.assign(new Error(`Box folder missing: ${segments.join('/')}`), { code: 'ENOENT' })
    }
    return parent
  }

  private async find(parentId: string, name: string, type: BoxItem['type']) {
    return (await this.children(parentId)).find((item) => item.name === name && item.type === type)
  }
  private async children(parentId: string, limit = 1000) {
    const entries: BoxItem[] = []
    let offset = 0
    let total = 1
    do {
      const response = await this.request(
        `${API}/folders/${parentId}/items?limit=${limit}&offset=${offset}&fields=id,type,name,size,parent`,
        { method: 'GET' },
      )
      const page = (await response.json()) as { entries?: BoxItem[]; total_count?: number }
      entries.push(...(page.entries ?? []))
      if (limit === 1) return entries
      offset = entries.length
      total = page.total_count ?? offset
    } while (offset < total)
    return entries
  }
  private async createFolder(parentId: string, name: string) {
    const response = await this.request(`${API}/folders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, parent: { id: parentId } }),
    })
    return (await response.json()) as BoxItem
  }
  private async deleteItem(item: BoxItem) {
    try {
      await this.request(`${API}/${item.type}s/${item.id}${item.type === 'folder' ? '?recursive=true' : ''}`, { method: 'DELETE' })
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error
    }
  }

  private async request(url: string, init: { method: string; headers?: Record<string, string>; body?: BodyInit }) {
    const token = await this.token()
    for (let attempt = 0; ; attempt++) {
      const response = await cloudFetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } })
      if (response.ok || response.status === 201 || response.status === 202) return response
      const error = await boxError(response)
      if (!error.retryable || attempt === 5) throw error
      await waitForCloudRetry(attempt, { delayMs: error.retryAfterMs })
    }
  }

  protected async refreshAccessToken() {
    if (!this.connection.clientId || !this.connection.clientSecret || !this.connection.refreshToken) throw new Error('Box is not connected')
    const token = await refreshOAuthAccessToken(TOKEN, {
      parameters: {
        client_id: this.connection.clientId,
        client_secret: this.connection.clientSecret,
        refresh_token: this.connection.refreshToken,
        grant_type: 'refresh_token',
      },
      fetch: cloudFetch,
      error: boxError,
    })
    if (token.refreshToken && token.refreshToken !== this.connection.refreshToken) {
      this.connection.refreshToken = token.refreshToken
      this.updateRefreshToken?.(token.refreshToken)
    }
    return token
  }
}

async function boxError(response: Response) {
  return cloudRequestError('Box', response, (_body, failed) => ({
    retryable: failed.status === 429 || failed.status >= 500,
    retryAfterMs: Number(failed.headers.get('retry-after') ?? 0) * 1000,
  }))
}
