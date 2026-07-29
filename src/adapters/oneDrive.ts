import crypto from 'node:crypto'
import type { CloudStorageCredentials } from '../core/auth'
import { STORAGE_SCAFFOLD_FOLDERS } from '../core/assetKeys'
import type { AssetStore } from '../core/types'
import { hasInvalidRelativePathSegment } from '../core/storagePath'
import { cloudFetch, cloudRequestError, waitForCloudRetry } from './cloudFetch'
import { cleanCloudRoot, cloudFileName } from './cloudPath'
import { OAuthAccessTokenCache, refreshOAuthAccessToken } from './oauthAccessToken'
import { streamChunks } from './streamChunks'
import { AssetStoreKeys } from './assetStoreKeys'
import { finalizeCloudUpload } from './finalizeCloudUpload'
import { StorageInventoryBuilder } from './storageInventory'
import { assetMissingError } from './missingFile'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024

type DriveItem = { id: string; name: string; size?: number; folder?: Record<string, unknown>; parentReference?: { id?: string } }

export class OneDriveAssetStore extends AssetStoreKeys implements AssetStore {
  private tokens = new OAuthAccessTokenCache()
  private root: string

  constructor(
    root: string,
    private connection: CloudStorageCredentials,
    private updateRefreshToken?: (refreshToken: string) => void,
  ) {
    super()
    this.root = cleanCloudRoot(root, 'OneDrive')
  }

  async initialize() {
    await this.rootItem(true)
    for (const folder of STORAGE_SCAFFOLD_FOLDERS) {
      await this.folderItem(folder, true)
    }
  }

  async finalizeUpload(stagedPath: string, relativePath: string) {
    await finalizeCloudUpload(
      stagedPath,
      relativePath,
      () => this.stat(relativePath),
      (stream, size) => this.writeStream(relativePath, stream, size),
    )
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
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace', name: cloudFileName(relativePath) } }),
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
    if (!item) throw assetMissingError(relativePath)
    const response = await this.request(`${this.itemUrl(relativePath)}:/content`, { method: 'GET', headers: {} })
    if (!response.body) throw new Error(`empty OneDrive response: ${relativePath}`)
    return { stream: response.body, size: item.size ?? Number(response.headers.get('content-length') ?? 0) }
  }

  async stat(relativePath: string) {
    const item = await this.item(relativePath)
    return item && !item.folder ? { size: item.size ?? 0 } : undefined
  }

  async ensureMoved(sourcePath: string, destinationPath: string) {
    if (sourcePath === destinationPath) return
    const [source, destination] = await Promise.all([this.item(sourcePath), this.item(destinationPath)])
    if (!source && destination) return
    if (!source) throw assetMissingError(sourcePath)
    if (destination && destination.size !== source.size) throw new Error(`asset destination already exists: ${destinationPath}`)
    if (destination) return this.deleteItem(source.id)
    const parent = await this.parentItem(destinationPath, true)
    await this.request(`${GRAPH}/me/drive/items/${encodeURIComponent(source.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: cloudFileName(destinationPath), parentReference: { id: parent.id } }),
    })
  }

  async exists(relativePath: string) {
    return !!(await this.item(relativePath))
  }

  async remove(relativePath: string) {
    const item = await this.item(relativePath)
    if (item) await this.deleteItem(item.id)
  }

  async removeEmptyDirectory(relativePath: string) {
    const folder = await this.folderItem(relativePath, false).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!folder) return true
    const response = await this.request(`${GRAPH}/me/drive/items/${encodeURIComponent(folder.id)}/children?$top=1`, {
      method: 'GET',
      headers: {},
    })
    if (((await response.json()) as { value?: DriveItem[] }).value?.length) return false
    await this.deleteItem(folder.id)
    return true
  }

  async trash(relativePath: string) {
    if (!(await this.item(relativePath))) return undefined
    const next = `.stlquest/trash/${crypto.randomUUID()}__${cloudFileName(relativePath)}`
    await this.ensureMoved(relativePath, next)
    return next
  }

  async sweepTrash() {
    const trash = await this.folderItem('.stlquest/trash', false).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (trash) await this.deleteItem(trash.id)
    await this.folderItem('.stlquest/trash', true)
  }

  async writable() {
    const probe = `.stlquest/health-${crypto.randomUUID()}`
    await this.write(probe, new Uint8Array([1]))
    const readable = await this.read(probe)
    await readable.stream.cancel()
    await this.remove(probe)
  }

  async inventory() {
    const root = await this.rootItem(false)
    const inventory = new StorageInventoryBuilder()
    const visit = async (parent: DriveItem, relative = ''): Promise<void> => {
      let url: string | undefined = `${GRAPH}/me/drive/items/${encodeURIComponent(parent.id)}/children`
      while (url) {
        const response = await this.request(url, { method: 'GET', headers: {} })
        const page = (await response.json()) as { value?: DriveItem[]; '@odata.nextLink'?: string }
        for (const entry of page.value ?? []) {
          const child = [relative, entry.name].filter(Boolean).join('/')
          if (entry.folder) {
            inventory.addFolder(child)
            await visit(entry, child)
          } else {
            inventory.addFile(child, entry.size ?? 0)
          }
        }
        url = page['@odata.nextLink']
      }
    }
    await visit(root)
    return inventory.result()
  }

  async clear(options?: { initialize?: boolean }) {
    const root = await this.rootItem(false)
    await this.deleteItem(root.id)
    if (options?.initialize !== false) await this.initialize()
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
    validatePath(relativePath)
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
    validatePath(relativePath)
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
    return retryOneDriveRequest(() =>
      cloudFetch(url, { method: init.method, headers: { ...init.headers, authorization: `Bearer ${token}` }, body }),
    )
  }

  private async token() {
    return this.tokens.get(() => this.refreshToken())
  }

  private async refreshToken() {
    if (!this.connection.clientId || !this.connection.clientSecret || !this.connection.refreshToken)
      throw new Error('OneDrive is not connected')
    const token = await refreshOAuthAccessToken(TOKEN, {
      parameters: {
        client_id: this.connection.clientId,
        client_secret: this.connection.clientSecret,
        refresh_token: this.connection.refreshToken,
        grant_type: 'refresh_token',
        scope: 'offline_access User.Read Files.ReadWrite',
      },
      fetch: cloudFetch,
      error: oneDriveError,
    })
    if (token.refreshToken && token.refreshToken !== this.connection.refreshToken) {
      this.connection.refreshToken = token.refreshToken
      this.updateRefreshToken?.(token.refreshToken)
    }
    return token
  }
}

function validatePath(relativePath: string) {
  if (relativePath && hasInvalidRelativePathSegment(relativePath)) throw new Response('invalid path', { status: 400 })
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

async function requestUploadSession(url: string, chunk: Uint8Array, start: number, end: number, total: number) {
  return retryOneDriveRequest(() =>
    cloudFetch(url, {
      method: 'PUT',
      headers: { 'content-length': String(chunk.byteLength), 'content-range': `bytes ${start}-${end}/${total}` },
      body: new Uint8Array(chunk),
    }),
  )
}

async function retryOneDriveRequest(request: () => Promise<Response>) {
  for (let attempt = 0; ; attempt++) {
    const response = await request()
    if (response.ok) return response
    const error = await oneDriveError(response)
    if (!error.retryable || attempt === 5) throw error
    await waitForCloudRetry(attempt, { delayMs: error.retryAfterMs })
  }
}

async function oneDriveError(response: Response) {
  return cloudRequestError('OneDrive', response, (_body, failedResponse) => {
    const retryAfter = Number(failedResponse.headers.get('retry-after') ?? 0)
    return {
      retryable: failedResponse.status === 429 || failedResponse.status >= 500,
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0,
    }
  })
}
