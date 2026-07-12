import { SqliteRepository } from '../adapters/sqlite'
import { LocalAssetStore } from '../adapters/filesystem'
import { S3AssetStore } from '../adapters/s3'
import { UploadStaging } from '../adapters/staging'
import { LocalAuthProvider, TrustedHeaderAuthProvider } from '../adapters/auth'
import { LocalEventBus } from '../adapters/events'
import { OptionalPostHogTelemetry } from '../adapters/telemetry'
import { PrintHubService } from '../core/services'
import type { AuthConfig, BoardConfig, Repository, StorageConfig, TelemetryConfig } from '../core/types'

const singleton = globalThis as typeof globalThis & { __printhub?: ReturnType<typeof createApp> }

export function resolveStorageConfig(repository: Repository): StorageConfig {
  return repository.getSetting<StorageConfig>('storage') ?? { adapter: 'local', root: '/prints' }
}

export function resolveAuthConfig(repository: Repository): AuthConfig {
  return repository.getSetting<AuthConfig>('auth') ?? { provider: 'local' }
}

export function resolveTelemetryConfig(repository: Repository): TelemetryConfig | undefined {
  return repository.getSetting<TelemetryConfig>('telemetry')
}

// Read per call, not at boot: flipping visibility applies instantly.
export function resolveBoardConfig(repository: Repository): BoardConfig {
  return repository.getSetting<BoardConfig>('board') ?? { privateRequests: false }
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
    const staging = new UploadStaging()
    await staging.initialize()
    const events = new LocalEventBus()
    const telemetryConfig = resolveTelemetryConfig(repository)
    const telemetry = new OptionalPostHogTelemetry(telemetryConfig)
    const authConfig = resolveAuthConfig(repository)
    const auth = authConfig.provider === 'trusted-header'
      ? new TrustedHeaderAuthProvider(repository, authConfig)
      : new LocalAuthProvider(repository)
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
      await Promise.allSettled([
        staging.remove(staging.uploadPart(uploadId)),
        staging.remove(staging.uploadPreviewPart(uploadId)),
      ])
    }
    await staging.sweepUploads(repository.activeUploadIds(Date.now()))
    return { repository, assets, staging, events, telemetry, auth, service, storage, authConfig, telemetryConfig, storageReady }
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
