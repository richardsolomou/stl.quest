import { SqliteRepository } from '../adapters/sqlite'
import { LocalAssetStore } from '../adapters/filesystem'
import { S3AssetStore } from '../adapters/s3'
import { UploadStaging } from '../adapters/staging'
import { LocalAuthProvider, TrustedHeaderAuthProvider } from '../adapters/auth'
import { LocalEventBus } from '../adapters/events'
import { OptionalPostHogTelemetry } from '../adapters/telemetry'
import { PrintHubService } from '../core/services'
import type { Repository, StorageConfig } from '../core/types'

const singleton = globalThis as typeof globalThis & { __printhub?: ReturnType<typeof createApp> }

// PRINTS_DIR only seeds the default; once the operator saves storage
// settings, the database wins.
export function resolveStorageConfig(repository: Repository): StorageConfig {
  return repository.getSetting<StorageConfig>('storage') ?? { adapter: 'local', root: process.env.PRINTS_DIR ?? '/prints' }
}

export function buildAssetStore(config: StorageConfig) {
  return config.adapter === 's3' ? new S3AssetStore(config) : new LocalAssetStore(config.root)
}

async function createApp() {
  let repository: SqliteRepository | undefined
  try {
    repository = SqliteRepository.open()
    const storage = resolveStorageConfig(repository)
    const assets = buildAssetStore(storage)
    await assets.initialize()
    const staging = new UploadStaging()
    await staging.initialize()
    const events = new LocalEventBus()
    const telemetry = new OptionalPostHogTelemetry()
    const auth = process.env.AUTH_PROVIDER === 'trusted-header'
      ? new TrustedHeaderAuthProvider(repository)
      : new LocalAuthProvider(repository)
    const service = new PrintHubService(repository, assets, staging, events, telemetry)
    await service.recoverOperations()
    repository.reconcileWorkflow()
    for (const uploadId of repository.expireUploads(Date.now())) {
      await Promise.allSettled([
        staging.remove(staging.uploadPart(uploadId)),
        staging.remove(staging.uploadPreviewPart(uploadId)),
      ])
    }
    await staging.sweepUploads(repository.activeUploadIds(Date.now()))
    await assets.sweepTrash()
    return { repository, assets, staging, events, telemetry, auth, service, storage }
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
