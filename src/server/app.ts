import crypto from 'node:crypto'
import { SqliteRepository } from '../adapters/sqlite'
import { LocalAssetStore } from '../adapters/filesystem'
import { S3AssetStore } from '../adapters/s3'
import { UploadStaging } from '../adapters/staging'
import { LocalEventBus } from '../adapters/events'
import { OptionalPostHogTelemetry } from '../adapters/telemetry'
import { PrintHubService } from '../core/services'
import { AssetGenerationQueue } from './assets/queue'
import { createAuth } from './auth'
import type { BoardConfig, Identity, Repository, StorageConfig, TelemetryConfig } from '../core/types'

const singleton = globalThis as typeof globalThis & { __printhub?: ReturnType<typeof createApp> }

export function resolveStorageConfig(repository: Repository): StorageConfig {
  return repository.getSetting<StorageConfig>('storage') ?? { adapter: 'local', root: '/prints' }
}

// Read per call, not at boot: flipping the setting applies instantly on the
// server, and the browser picks it up on its next page load.
export function resolveTelemetryConfig(repository: Repository): TelemetryConfig {
  return { enabled: repository.getSetting<TelemetryConfig>('telemetry')?.enabled !== false }
}

// Read per call, not at boot: flipping visibility applies instantly.
export function resolveBoardConfig(repository: Repository): BoardConfig {
  return repository.getSetting<BoardConfig>('board') ?? { privateRequests: false }
}

export function buildAssetStore(config: StorageConfig) {
  return config.adapter === 's3' ? new S3AssetStore(config) : new LocalAssetStore(config.root)
}

// Session-signing secret for better-auth: generated on first boot and kept in
// the settings table, because an appliance has no environment to configure.
function resolveAuthSecret(repository: Repository) {
  const existing = repository.getSetting<string>('authSecret')
  if (existing) return existing
  const secret = crypto.randomBytes(32).toString('base64url')
  repository.setSetting('authSecret', secret)
  return secret
}

async function createApp() {
  let repository: SqliteRepository | undefined
  try {
    repository = SqliteRepository.open()
    const storage = resolveStorageConfig(repository)
    const assets = buildAssetStore(storage)
    const staging = new UploadStaging()
    await staging.initialize()
    const events = new LocalEventBus()
    const telemetry = new OptionalPostHogTelemetry(() => resolveTelemetryConfig(repository!).enabled)
    const auth = createAuth(repository.database, resolveAuthSecret(repository), () => events.publish('user.created'))
    const identity = async (headers: Headers): Promise<Identity | undefined> => {
      const session = await auth.api.getSession({ headers })
      if (!session) return undefined
      const { user } = session
      return { id: user.id, email: user.email, name: user.name, role: user.role === 'operator' ? 'operator' : 'requester' }
    }
    const requireIdentity = async (headers: Headers) => {
      const found = await identity(headers)
      if (!found) throw new Response('unauthenticated', { status: 401 })
      return found
    }
    const service = new PrintHubService(repository, assets, staging, events, telemetry)
    // Unreachable storage must not stop boot: the app has to come up so the
    // operator can fix the storage settings. Health stays red until then.
    let storageReady = true
    try {
      await assets.initialize()
      await service.recoverOperations()
      await assets.sweepTrash()
    } catch (error) {
      storageReady = false
      console.warn('[printhub] storage is not ready; configure it in Settings → Storage:', error instanceof Error ? error.message : error)
    }
    repository.reconcileWorkflow()
    for (const uploadId of repository.expireUploads(Date.now())) {
      await staging.remove(staging.uploadPart(uploadId))
    }
    await staging.sweepUploads(repository.activeUploadIds(Date.now()))
    const assetQueue = new AssetGenerationQueue(repository, assets, events, telemetry)
    // Requests that never got their thumbnail or preview — crash before
    // generation, imported boards, storage fixed after being down — catch up
    // in the background once storage works.
    if (storageReady) assetQueue.backfill()
    return { repository, assets, staging, events, telemetry, auth, identity, requireIdentity, service, assetQueue, storage, storageReady }
  } catch (error) {
    repository?.close()
    throw error
  }
}

export function app() {
  if (singleton.__printhub) return singleton.__printhub
  const pending = createApp()
  singleton.__printhub = pending
  void pending.catch(() => {
    if (singleton.__printhub === pending) delete singleton.__printhub
  })
  return pending
}

// Tears the singleton down so the next request rebuilds with fresh
// configuration. Only safe while the board is empty; callers guard that.
export async function resetApp() {
  const running = singleton.__printhub
  delete singleton.__printhub
  if (running) (await running.catch(() => undefined))?.repository.close()
}
