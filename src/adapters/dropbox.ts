import type { CloudStorageCredentials } from '../core/auth'
import type { AssetStore } from '../core/types'
import { assertRelativeStoragePath } from '../core/storagePath'
import { cloudFetch, cloudRequestError, waitForCloudRetry } from './cloudFetch'
import { cleanCloudRoot, joinCloudPath } from './cloudPath'
import { refreshOAuthAccessToken } from './oauthAccessToken'
import { assertStreamSize, streamChunks } from './streamChunks'
import { OAuthAssetStoreKeys } from './oauthAssetStoreKeys'
import { StorageInventoryBuilder } from './storageInventory'
import { prepareAssetMove } from './assetMove'
import { verifyWritableAssetStore } from './writableAssetStore'

const API = 'https://api.dropboxapi.com/2'
const CONTENT = 'https://content.dropboxapi.com/2'
const TOKEN = 'https://api.dropboxapi.com/oauth2/token'
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

type DropboxMetadata = { '.tag': 'file' | 'folder'; path_display?: string; size?: number }

export class DropboxAssetStore extends OAuthAssetStoreKeys implements AssetStore {
  private folders = new Map<string, Promise<void>>()
  private root: string

  constructor(
    root: string,
    private connection: CloudStorageCredentials,
  ) {
    super()
    this.root = cleanCloudRoot(root, 'Dropbox')
  }

  async initialize() {
    await this.initializeStorageScaffold((folder) => this.createFolder(folder))
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
    assertStreamSize(offset, size, relativePath)
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

  async ensureMoved(sourcePath: string, destinationPath: string) {
    const move = await prepareAssetMove(
      sourcePath,
      destinationPath,
      (path) => this.stat(path),
      (asset) => asset.size,
    )
    if (!move) return
    const { destination } = move
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

  async removeEmptyDirectory(relativePath: string) {
    try {
      const result = await this.rpc<{ entries: DropboxMetadata[] }>('/files/list_folder', { path: this.path(relativePath), limit: 1 })
      if (result.entries.length > 0) return false
      await this.remove(relativePath)
      return true
    } catch (error) {
      if (isDropboxNotFound(error)) return true
      throw error
    }
  }

  async sweepTrash() {
    await this.remove('trash')
    await this.createFolder('trash')
  }

  async writable() {
    await verifyWritableAssetStore({ write: (path, bytes) => this.write(path, bytes), remove: (path) => this.remove(path) })
  }

  async inventory(options?: { maxEntries?: number }) {
    const entries: DropboxMetadata[] = []
    let page = await this.rpc<{ entries: DropboxMetadata[]; cursor: string; has_more: boolean }>('/files/list_folder', {
      path: `/${this.root}`,
      recursive: true,
    })
    entries.push(...page.entries)
    while (page.has_more) {
      page = await this.rpc('/files/list_folder/continue', { cursor: page.cursor })
      entries.push(...page.entries)
    }
    const inventory = new StorageInventoryBuilder(options?.maxEntries)
    for (const entry of entries) {
      const relative = (entry.path_display ?? '')
        .replace(/^\/+/, '')
        .slice(this.root.length)
        .replace(/^\/+|\/+$/g, '')
      if (!relative) continue
      if (entry['.tag'] === 'folder') {
        inventory.addFolder(relative)
      } else {
        inventory.addFile(relative, entry.size ?? 0)
      }
    }
    return inventory.result()
  }

  async clear(options?: { initialize?: boolean }) {
    await this.rpc('/files/delete_v2', { path: `/${this.root}` }).catch((error) => {
      if (!isDropboxNotFound(error)) throw error
    })
    this.folders.clear()
    if (options?.initialize !== false) await this.initialize()
  }

  private path(relativePath: string) {
    assertRelativeStoragePath(relativePath)
    return `/${joinCloudPath(this.root, relativePath)}`
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
      await waitForCloudRetry(attempt, { minimumDelayMs: error.retryAfterMs })
    }
  }

  protected async refreshAccessToken() {
    if (!this.connection.clientId || !this.connection.clientSecret || !this.connection.refreshToken)
      throw new Error('Dropbox is not connected')
    return refreshOAuthAccessToken(TOKEN, {
      parameters: { grant_type: 'refresh_token', refresh_token: this.connection.refreshToken },
      headers: {
        authorization: `Basic ${Buffer.from(`${this.connection.clientId}:${this.connection.clientSecret}`).toString('base64')}`,
      },
      fetch: cloudFetch,
      error: dropboxError,
    })
  }
}

function uploadCommit(path: string) {
  return { path, mode: 'overwrite', autorename: false, mute: true, strict_conflict: false }
}

function dropboxArgument(argument: unknown) {
  return JSON.stringify(argument).replace(/[\u007f-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

async function dropboxError(response: Response) {
  return cloudRequestError('Dropbox', response, (body, failedResponse) => {
    const retryAfterHeader = failedResponse.headers.get('retry-after')
    const headerRetryAfter = retryAfterHeader === null ? undefined : Number(retryAfterHeader)
    const bodyRetryAfter = Number(body.match(/"retry_after"\s*:\s*(\d+)/)?.[1])
    return {
      retryAfterMs: 1_000 * (headerRetryAfter !== undefined && Number.isFinite(headerRetryAfter) ? headerRetryAfter : bodyRetryAfter || 0),
    }
  })
}

function isDropboxNotFound(error: unknown) {
  const candidate = error as { status?: number; body?: string }
  return candidate.status === 409 && candidate.body?.includes('not_found')
}

function isDropboxFolderConflict(error: unknown) {
  const candidate = error as { status?: number; body?: string }
  return candidate.status === 409 && candidate.body?.includes('conflict') && candidate.body.includes('folder')
}
