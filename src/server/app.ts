import crypto from 'node:crypto'
import path from 'node:path'
import { SqliteRepository } from '../adapters/sqlite'
import { LocalAssetStore } from '../adapters/filesystem'
import { S3AssetStore } from '../adapters/s3'
import { UploadStaging } from '../adapters/staging'
import { LocalEventBus } from '../adapters/events'
import { OptionalPostHogTelemetry } from '../adapters/telemetry'
import { resolveAuthAdapterConfig } from '../adapters/auth'
import { buildEmailDelivery, resolveSmtpConfig } from '../adapters/email'
import { PrintHubService } from '../core/services'
import { AssetGenerationQueue } from './assets/queue'
import { createAuth } from './auth'
import type { BoardConfig, Identity, Repository, StorageConfig, TelemetryConfig } from '../core/types'
import { logger } from './logger'
import { databaseMetrics, diskFreeBytes, incompleteUploads, storageFailures } from './metrics'
import { diagnostics } from './operations'
import { getStoredIntegrationConfig } from './integrations'
import { userImage } from './avatar'
import { acquireDataDirectoryLease, networkFilesystem } from './dataSafety'

const singleton = globalThis as typeof globalThis & { __printhub?: ReturnType<typeof createApp> }

export function resolveStorageConfig(repository: Repository): StorageConfig {
  return repository.getSetting<StorageConfig>('storage') ?? { adapter: 'local', root: process.env.PRINTS_DIR ?? '/prints' }
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

export function hashInviteToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
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
  const dataDirectory = path.resolve(process.env.DATA_DIR ?? '/data')
  const lease = acquireDataDirectoryLease(dataDirectory)
  try {
    const filesystem = networkFilesystem(dataDirectory)
    if (filesystem) logger.warn({ dataDirectory, filesystem }, 'SQLite data directory is on an unsafe network filesystem')
    repository = SqliteRepository.open()
    const storage = resolveStorageConfig(repository)
    const assets = buildAssetStore(storage)
    const staging = new UploadStaging()
    await staging.initialize()
    const events = new LocalEventBus()
    const telemetry = new OptionalPostHogTelemetry(() => resolveTelemetryConfig(repository!).enabled)
    const storedIntegrations = getStoredIntegrationConfig(repository)
    const authConfig = resolveAuthAdapterConfig(storedIntegrations)
    const smtpConfig = resolveSmtpConfig(storedIntegrations)
    const email = buildEmailDelivery(smtpConfig)
    const auth = createAuth(repository.database, resolveAuthSecret(repository), {
      onUserCreated: () => events.publish('user.created'),
      claimInvite: (token) => repository!.claimInvite(hashInviteToken(token), Date.now()),
      completeInvite: (id, userId) => repository!.completeInvite(id, userId),
      auth: { ...authConfig, passwordReset: authConfig.password && email !== undefined },
      email,
    })
    const identity = async (headers: Headers): Promise<Identity | undefined> => {
      const session = await auth.api.getSession({ headers })
      if (!session) return undefined
      const { user } = session
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: userImage(user.email, user.image),
        role: user.role === 'admin' ? 'admin' : 'requester',
        twoFactorEnabled: user.twoFactorEnabled ?? false,
      }
    }
    const requireIdentity = async (headers: Headers) => {
      const found = await identity(headers)
      if (!found) throw new Response('unauthenticated', { status: 401 })
      return found
    }
    const service = new PrintHubService(repository, assets, staging, events, telemetry)
    // Unreachable storage must not stop boot: the app has to come up so the
    // admin can fix the storage settings. Health stays red until then.
    let storageReady = false
    let assetQueue: AssetGenerationQueue | undefined
    let storageRecovery: Promise<boolean> | undefined
    const recoverStorage = () => {
      if (storageRecovery) return storageRecovery
      storageRecovery = (async () => {
        try {
          await assets.initialize()
          await service.recoverOperations()
          await assets.sweepTrash()
          const wasReady = storageReady
          storageReady = true
          assetQueue?.backfill()
          if (!wasReady) logger.info('storage connection recovered')
          return true
        } catch (error) {
          storageReady = false
          storageFailures.inc()
          logger.warn({ err: error }, 'storage is not ready; configure it in Settings → Storage')
          return false
        } finally {
          storageRecovery = undefined
        }
      })()
      return storageRecovery
    }
    await recoverStorage()
    repository.reconcileWorkflow()
    for (const uploadId of repository.expireUploads(Date.now())) {
      await staging.remove(staging.uploadPart(uploadId))
    }
    await staging.sweepUploads(repository.activeUploadIds(Date.now()))
    const { cleanExpiredTusUploads } = await import('./uploads')
    await cleanExpiredTusUploads()
    assetQueue = new AssetGenerationQueue(repository, assets, events, telemetry)
    // Fill missing visual assets and orientation analyses in the background.
    if (storageReady) assetQueue.backfill()
    const refreshDiagnostics = async () => {
      const current = await diagnostics(repository!, storage, assets)
      databaseMetrics.set({ measure: 'size_bytes' }, current.database.sizeBytes)
      databaseMetrics.set({ measure: 'last_integrity_check_seconds' }, current.database.lastCheckedAt / 1000)
      if (current.dataCapacity) diskFreeBytes.set({ mount: 'data' }, current.dataCapacity.freeBytes)
      if (current.storageCapacity) diskFreeBytes.set({ mount: 'storage' }, current.storageCapacity.freeBytes)
      const uploads = repository!.incompleteUploadStats(Date.now())
      incompleteUploads.set({ measure: 'count' }, uploads.count)
      incompleteUploads.set({ measure: 'bytes' }, uploads.bytes)
      return current
    }
    if (storageReady) await refreshDiagnostics()
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      try {
        events.close()
        await assetQueue.shutdown()
      } finally {
        repository?.close()
        lease.release()
      }
    }
    return {
      repository,
      assets,
      staging,
      events,
      telemetry,
      auth,
      authCapabilities: {
        password: authConfig.password,
        passwordReset: authConfig.password && email !== undefined,
        socialProviders: authConfig.socialProviders,
      },
      emailCapabilities: { configured: email !== undefined },
      emailDelivery: email,
      integrationConfig: storedIntegrations ?? { passwordEnabled: true },
      identity,
      requireIdentity,
      service,
      assetQueue,
      storage,
      get storageReady() {
        return storageReady
      },
      recoverStorage,
      refreshDiagnostics,
      close,
    }
  } catch (error) {
    repository?.close()
    lease.release()
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
  const instance = running ? await running.catch(() => undefined) : undefined
  await instance?.close()
  logger.info('application singleton reset')
}

export async function shutdownApp() {
  const running = singleton.__printhub
  delete singleton.__printhub
  const instance = running ? await running.catch(() => undefined) : undefined
  await instance?.close()
}

const lifecycle = globalThis as typeof globalThis & { __printhubSignals?: boolean }
if (!lifecycle.__printhubSignals && process.env.NODE_ENV !== 'test') {
  lifecycle.__printhubSignals = true
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdownApp().finally(() => process.exit(0))
    })
  }
}
