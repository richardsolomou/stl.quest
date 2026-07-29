import crypto from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import pRetry from 'p-retry'
import { isRetryableError } from '../adapters/retryableError'
import { formatBytes } from '../core/format'
import { requestAssetPaths } from '../core/request'
import type { AssetStore, Repository, StorageConfig, StorageMigration, Telemetry } from '../core/types'
import type { AssetGenerationQueue } from './assets/queue'
import { encryptSetting } from './integrations'
import { logger } from './logger'
import { acquireWorkLease, type WorkLease, type WorkLocker, WorkLeaseLost } from './workLock'

export const STORAGE_MIGRATION_SETTING = 'storage-migration'
export const LEGACY_STORAGE_NAMESPACE_SETTING = 'legacy-storage-namespace'
export const STORAGE_RUNTIME_REVISION_SETTING = 'storage-runtime-revision'
export const MANAGED_STORAGE_CLEANUP_SETTING = 'managed-storage-cleanup'
export const LEGACY_CLOUD_STORAGE_CLEANUP_SETTING = 'legacy-cloud-storage-cleanup'

export type ManagedStorageCleanup = { purpose: 'release' } | { purpose: 'abandon-migration'; migrationId: string }
export type LegacyCloudStorageCleanup = { source: StorageConfig }

export async function completeManagedStorageCleanup(repository: Repository, store: AssetStore) {
  const cleanup = await repository.getSetting<ManagedStorageCleanup>(MANAGED_STORAGE_CLEANUP_SETTING)
  if (!cleanup) return
  await store.clear()
  if (cleanup.purpose === 'release') {
    await repository.setSettingsAndReleaseManagedStorage({}, [MANAGED_STORAGE_CLEANUP_SETTING])
    return
  }
  const migration = await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)
  if (!migration || migration.id !== cleanup.migrationId || migration.state !== 'failed') {
    throw new Error('managed storage cleanup no longer matches the failed migration')
  }
  const finishedAt = Date.now()
  await repository.setSettingsAndReleaseManagedStorage(
    {
      [STORAGE_MIGRATION_SETTING]: {
        ...migration,
        state: 'cancelled',
        error: undefined,
        currentPath: undefined,
        updatedAt: finishedAt,
        finishedAt,
      },
    },
    [MANAGED_STORAGE_CLEANUP_SETTING],
  )
}

type BuildStore = (config: StorageConfig) => Promise<AssetStore>
type Activate = () => Promise<void>
type ClearDestination = (config: StorageConfig) => Promise<void>
type RetryBackoff = { minTimeout: number; maxTimeout: number; randomize: boolean }
type RetryEvent =
  | 'storage_migration_clear_retry'
  | 'storage_migration_initialize_retry'
  | 'storage_migration_inspect_retry'
  | 'storage_migration_copy_retry'

const DEFAULT_RETRY_BACKOFF: RetryBackoff = { minTimeout: 1_000, maxTimeout: 30_000, randomize: true }

class MigrationCancelled extends Error {}
// Expected, operator-actionable failures (e.g. storage quota exceeded). These still flip the
// migration to `failed` with an actionable message, but they are not application bugs — so they are
// logged without an `err` field to keep them out of error tracking (see the level-50 exception hook
// in logger.ts).
class ExpectedMigrationFailure extends Error {}
type DistributedMigrationOptions = { workLocker: WorkLocker; lockId: string }
type MigrationLease = WorkLease & { ownerId: string }

type StorageMigrationCoordinatorOptions = {
  repository: Repository
  source: AssetStore
  sourceConfig: StorageConfig
  queue: AssetGenerationQueue
  buildStore: BuildStore
  activate: Activate
  telemetry: Telemetry
  clearDestination?: ClearDestination
  retryBackoff?: RetryBackoff
  distributed?: DistributedMigrationOptions
}

export class StorageMigrationCoordinator {
  private running?: Promise<void>
  private assetsLocked = false
  private migrationSignal?: AbortSignal
  private migrationOwnerId?: string

  private repository: Repository
  private source: AssetStore
  private sourceConfig: StorageConfig
  private queue: AssetGenerationQueue
  private buildStore: BuildStore
  private activate: Activate
  private telemetry: Telemetry
  private clearDestination?: ClearDestination
  private retryBackoff: RetryBackoff
  private distributed?: DistributedMigrationOptions

  constructor(options: StorageMigrationCoordinatorOptions) {
    this.repository = options.repository
    this.source = options.source
    this.sourceConfig = options.sourceConfig
    this.queue = options.queue
    this.buildStore = options.buildStore
    this.activate = options.activate
    this.telemetry = options.telemetry
    this.clearDestination = options.clearDestination
    this.retryBackoff = options.retryBackoff ?? DEFAULT_RETRY_BACKOFF
    this.distributed = options.distributed
  }

  async status() {
    return await this.repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)
  }

  async active() {
    return this.assetsLocked || (await this.status())?.state === 'running'
  }

  async withAssetsLocked<T>(callback: () => Promise<T>) {
    const migration = await this.status()
    if (this.assetsLocked || migration?.state === 'running')
      throw new Response('a storage migration is already in progress', { status: 409 })
    this.assetsLocked = true
    try {
      return await callback()
    } finally {
      this.assetsLocked = false
    }
  }

  async assertAssetsMutable() {
    if (await this.active()) throw new Response('storage migration is in progress; file changes are temporarily paused', { status: 423 })
  }

  async start(destination: StorageConfig, clearDestination = false) {
    this.assertDestinationChanged(destination)
    const lease = await this.acquireLease(true)
    try {
      return await this.withAssetsLocked(async () => await this.startMigration(destination, undefined, clearDestination, lease))
    } catch (error) {
      await lease?.release()
      throw error
    }
  }

  async startLegacyNamespace(destination: StorageConfig) {
    const lease = await this.acquireLease(false)
    if (this.distributed && !lease) return
    try {
      return await this.withAssetsLocked(async () => await this.startMigration(destination, 'legacy-namespace', false, lease))
    } catch (error) {
      await lease?.release()
      throw error
    }
  }

  async startCanonicalCloudRoot(destination: StorageConfig) {
    const lease = await this.acquireLease(false)
    if (this.distributed && !lease) return
    try {
      return await this.withAssetsLocked(async () => await this.startMigration(destination, 'canonical-cloud-root', false, lease))
    } catch (error) {
      await lease?.release()
      throw error
    }
  }

  private async startMigration(
    destination: StorageConfig,
    purpose?: StorageMigration['purpose'],
    clearDestination = false,
    lease?: MigrationLease,
  ) {
    this.assertDestinationChanged(destination)
    await this.assertReadyToStart()
    if (destination.adapter === 'managed') await this.repository.deleteSetting(MANAGED_STORAGE_CLEANUP_SETTING)

    const candidate = await this.prepareDestination(destination)

    const now = Date.now()
    const migration: StorageMigration = {
      id: crypto.randomUUID(),
      ownerId: lease?.ownerId,
      purpose,
      state: 'running',
      phase: clearDestination ? 'clearing' : 'copying',
      clearDestination,
      source: this.sourceConfig,
      destination,
      totalFiles: 0,
      totalBytes: 0,
      copiedFiles: 0,
      copiedBytes: 0,
      startedAt: now,
      updatedAt: now,
    }
    await this.repository.setSetting(STORAGE_MIGRATION_SETTING, migration)
    this.launch(migration, candidate, lease)
    return migration
  }

  private assertDestinationChanged(destination: StorageConfig) {
    if (JSON.stringify(destination) === JSON.stringify(this.sourceConfig))
      throw new Response('choose a different storage location', { status: 400 })
  }

  async retry() {
    const lease = await this.acquireLease(true)
    try {
      return await this.withAssetsLocked(async () => {
        const migration = await this.status()
        if (!migration || migration.state !== 'failed') throw new Response('there is no failed storage migration to retry', { status: 409 })
        await this.assertReadyToStart()
        if (migration.destination.adapter === 'managed') await this.repository.deleteSetting(MANAGED_STORAGE_CLEANUP_SETTING)
        const destination = await this.buildStore(migration.destination)
        const retried = await this.update({
          ...migration,
          ownerId: lease?.ownerId,
          state: 'running',
          phase: migration.phase ?? 'copying',
          error: undefined,
          finishedAt: undefined,
          cancelRequestedAt: undefined,
        })
        this.launch(retried, destination, lease)
        return retried
      })
    } catch (error) {
      await lease?.release()
      throw error
    }
  }

  async cancel() {
    const migration = await this.status()
    if (migration?.state === 'failed' && migration.source.adapter !== 'managed' && migration.destination.adapter === 'managed') {
      const lease = await this.acquireLease(true)
      try {
        return await this.withAssetsLocked(async () => {
          const current = await this.status()
          if (!current || current.id !== migration.id || current.state !== 'failed') {
            throw new Response('the failed storage migration changed; reload and try again', { status: 409 })
          }
          await this.repository.setSetting(MANAGED_STORAGE_CLEANUP_SETTING, {
            purpose: 'abandon-migration',
            migrationId: current.id,
          } satisfies ManagedStorageCleanup)
          const destination = await this.buildStore(current.destination)
          await completeManagedStorageCleanup(this.repository, destination)
          const cancelled = await this.status()
          if (!cancelled || cancelled.id !== current.id || cancelled.state !== 'cancelled') {
            throw new Error('failed to abandon managed storage migration')
          }
          await this.activate()
          return cancelled
        })
      } finally {
        await lease?.release()
      }
    }
    if (!migration || migration.state !== 'running') throw new Response('there is no running storage migration to cancel', { status: 409 })
    if (migration.cancelRequestedAt) return migration
    return await this.update({ ...migration, cancelRequestedAt: Date.now() })
  }

  async resume() {
    const migration = await this.status()
    if (!migration || migration.state !== 'running') return
    const lease = await this.acquireLease(false)
    if (this.distributed && !lease) return
    try {
      const owned = { ...migration, ownerId: lease?.ownerId, updatedAt: Date.now() }
      await this.repository.setSetting(STORAGE_MIGRATION_SETTING, owned)
      this.launch(owned, await this.buildStore(migration.destination), lease)
    } catch (error) {
      await lease?.release()
      throw error
    }
  }

  async waitForIdle() {
    await this.running
  }

  private launch(migration: StorageMigration, destination: AssetStore, lease?: MigrationLease) {
    if (this.running) {
      void lease?.release()
      return
    }
    this.migrationSignal = lease?.signal
    this.migrationOwnerId = lease?.ownerId
    this.running = this.run(migration, destination)
      .catch(async (error) => {
        const current = await this.status()
        if (current?.id !== migration.id || current.ownerId !== migration.ownerId) return
        const failed: StorageMigration = {
          ...migration,
          ...current,
          state: 'failed',
          currentPath: undefined,
          error: message(error),
          updatedAt: Date.now(),
          finishedAt: Date.now(),
        }
        await this.repository.setSetting(STORAGE_MIGRATION_SETTING, failed)
        if (error instanceof ExpectedMigrationFailure) {
          // Operator-actionable (e.g. over quota): log the reason without `err` so error tracking
          // doesn't mint an issue for an expected condition; telemetry still records the failure.
          logger.error({ event: 'storage_migration_failed', migration_id: migration.id, reason: failed.error }, 'storage migration failed')
        } else {
          logger.error({ err: error, event: 'storage_migration_failed', migration_id: migration.id }, 'storage migration failed')
        }
        void this.telemetry
          .capture('server', 'storage_migration_failed', { adapter: migration.destination.adapter, files_copied: migration.copiedFiles })
          .catch(() => undefined)
        await this.activate()
      })
      .finally(() => {
        this.running = undefined
        this.migrationSignal = undefined
        this.migrationOwnerId = undefined
        void lease?.release()
      })
  }

  private async run(initial: StorageMigration, destination: AssetStore) {
    this.assertLease()
    await this.queue.shutdown()
    while ((await this.repository.listAssetGenerationJobs()).some((job) => job.status === 'running')) {
      this.assertLease()
      await delay(50)
    }
    await this.assertReadyToStart()
    if (initial.clearDestination && initial.phase === 'clearing') {
      const clearDestination = this.clearDestination
      if (!clearDestination) throw new Error('destination clearing is unavailable')
      try {
        await this.retryTransient(initial, 'storage_migration_clear_retry', async () => await clearDestination(initial.destination))
      } catch (error) {
        if (error instanceof MigrationCancelled) return await this.finishCancelled(initial)
        throw error
      }
      initial = await this.update({ ...initial, phase: 'copying' })
      destination = await this.buildStore(initial.destination)
    }
    try {
      await this.retryTransient(initial, 'storage_migration_initialize_retry', async () => {
        await destination.initialize()
        await destination.writable()
      })
    } catch (error) {
      if (error instanceof MigrationCancelled) return await this.finishCancelled(initial)
      throw error
    }

    if (await this.cancelRequested(initial.id)) return await this.finishCancelled(initial)

    const paths = await assetPaths(this.repository, initial.purpose === 'canonical-cloud-root' ? this.source : undefined)
    const sizes = new Map<string, number>()
    let totalBytes = 0
    for (const relativePath of paths) {
      let source: Awaited<ReturnType<AssetStore['stat']>>
      let existing: Awaited<ReturnType<AssetStore['stat']>>
      try {
        ;[source, existing] = await this.retryTransient(initial, 'storage_migration_inspect_retry', async () => {
          const sourceStat = await this.source.stat(relativePath)
          return [sourceStat, sourceStat ? undefined : await destination.stat(relativePath)] as const
        })
      } catch (error) {
        if (error instanceof MigrationCancelled) return await this.finishCancelled(initial)
        throw error
      }
      const size = source?.size ?? (initial.purpose === 'legacy-namespace' ? existing?.size : undefined)
      if (size === undefined) throw new Error('source asset is missing')
      sizes.set(relativePath, size)
      totalBytes += size
    }

    let migration = await this.update({ ...initial, totalFiles: paths.length, totalBytes, copiedFiles: 0, copiedBytes: 0 })
    for (const relativePath of paths) {
      if (await this.cancelRequested(migration.id)) return await this.finishCancelled(migration)
      const size = sizes.get(relativePath)!
      let copyStarted = false
      migration = await this.update({ ...migration, currentPath: relativePath })
      try {
        await this.retryTransient(migration, 'storage_migration_copy_retry', async () => {
          const existing = await destination.stat(relativePath)
          if (existing?.size === size) return
          if (existing && !copyStarted) throw new Error('destination asset has a different size')
          const source = await this.source.read(relativePath)
          if (source.size !== size) throw new Error('source asset changed while copying')
          copyStarted = true
          await destination.writeStream(relativePath, source.stream, size)
          const copied = await destination.stat(relativePath)
          if (!copied || copied.size !== size) throw Object.assign(new Error('destination verification failed'), { retryable: true })
        })
      } catch (error) {
        if (error instanceof MigrationCancelled) return await this.finishCancelled(migration)
        if (httpStatus(error) === 413) {
          if (migration.destination.adapter === 'managed') {
            throw new ExpectedMigrationFailure(
              `Managed storage rejected ${relativePath} (${formatBytes(size)}) because copying it would exceed your storage quota. Free up space or raise the quota, then retry the migration.`,
              { cause: error },
            )
          }
          if (migration.destination.adapter === 'webdav') {
            const cloudflare = (error as { cloudflare?: boolean }).cloudflare === true
            throw new ExpectedMigrationFailure(
              cloudflare
                ? `Cloudflare rejected ${relativePath} (${formatBytes(size)}) because it exceeds the plan upload limit. Switch the WebDAV endpoint to Tailscale Funnel using the WebDAV setup guide, then retry the migration.`
                : `WebDAV rejected ${relativePath} (${formatBytes(size)}) because it exceeds the server or proxy upload limit. Increase the limit or use a direct endpoint such as Tailscale Funnel, then retry the migration.`,
              { cause: error },
            )
          }
        }
        throw error
      }
      migration = await this.update({
        ...migration,
        copiedFiles: migration.copiedFiles + 1,
        copiedBytes: migration.copiedBytes + size,
        currentPath: undefined,
      })
      if (await this.cancelRequested(migration.id)) return await this.finishCancelled(migration)
    }

    const finishedAt = Date.now()
    const completed: StorageMigration = {
      ...migration,
      state: 'completed',
      copiedFiles: paths.length,
      copiedBytes: totalBytes,
      currentPath: undefined,
      error: undefined,
      updatedAt: finishedAt,
      finishedAt,
    }
    const activeStorage = completed.purpose === 'legacy-namespace' ? completed.source : completed.destination
    await this.assertOwnership(completed.id)
    const cleanupManaged = completed.source.adapter === 'managed' && activeStorage.adapter !== 'managed'
    const settings = {
      storageEncrypted: encryptSetting(activeStorage),
      [STORAGE_MIGRATION_SETTING]: completed,
      [STORAGE_RUNTIME_REVISION_SETTING]: crypto.randomUUID(),
      ...(completed.purpose === 'legacy-namespace' ? { [LEGACY_STORAGE_NAMESPACE_SETTING]: true } : {}),
      ...(completed.purpose === 'canonical-cloud-root'
        ? { [LEGACY_CLOUD_STORAGE_CLEANUP_SETTING]: { source: completed.source } satisfies LegacyCloudStorageCleanup }
        : {}),
      ...(cleanupManaged ? { [MANAGED_STORAGE_CLEANUP_SETTING]: { purpose: 'release' } satisfies ManagedStorageCleanup } : {}),
    }
    await this.repository.setSettings(settings, ['storage'])
    if (completed.purpose === 'canonical-cloud-root') {
      try {
        await this.source.clear({ initialize: false })
        await this.repository.deleteSetting(LEGACY_CLOUD_STORAGE_CLEANUP_SETTING)
      } catch (error) {
        logger.warn({ err: error, event: 'legacy_cloud_storage_cleanup_pending' }, 'legacy cloud storage cleanup will retry on startup')
      }
    }
    if (cleanupManaged) {
      try {
        await completeManagedStorageCleanup(this.repository, this.source)
      } catch (error) {
        logger.warn({ err: error, event: 'managed_storage_cleanup_pending' }, 'managed storage cleanup will retry on startup')
      }
    }
    logger.info(
      { event: 'storage_migration_completed', migration_id: completed.id, files: completed.totalFiles, bytes: completed.totalBytes },
      'storage migration completed',
    )
    void this.telemetry
      .capture('server', 'storage_migration_completed', {
        adapter: completed.destination.adapter,
        files: completed.totalFiles,
        bytes: completed.totalBytes,
      })
      .catch(() => undefined)
    await this.activate()
  }

  private async cancelRequested(id: string) {
    const migration = await this.status()
    return migration?.id === id && migration.state === 'running' && migration.cancelRequestedAt !== undefined
  }

  private async finishCancelled(migration: StorageMigration) {
    const finishedAt = Date.now()
    const cancelled: StorageMigration = {
      ...migration,
      ...(await this.status()),
      state: 'cancelled',
      currentPath: undefined,
      error: undefined,
      updatedAt: finishedAt,
      finishedAt,
    }
    if (cancelled.destination.adapter === 'managed' && cancelled.source.adapter !== 'managed') {
      await this.repository.setSettings({
        [STORAGE_MIGRATION_SETTING]: cancelled,
        [MANAGED_STORAGE_CLEANUP_SETTING]: { purpose: 'release' } satisfies ManagedStorageCleanup,
      })
      try {
        await completeManagedStorageCleanup(this.repository, await this.buildStore(cancelled.destination))
      } catch (error) {
        logger.warn({ err: error, event: 'managed_storage_cleanup_pending' }, 'managed storage cleanup will retry on startup')
      }
    } else await this.repository.setSetting(STORAGE_MIGRATION_SETTING, cancelled)
    logger.info(
      { event: 'storage_migration_cancelled', migration_id: cancelled.id, files: cancelled.copiedFiles, bytes: cancelled.copiedBytes },
      'storage migration cancelled',
    )
    await this.activate()
  }

  private async assertReadyToStart() {
    if ((await this.repository.listOperations()).length > 0 || (await this.repository.activeUploadIds(Date.now())).size > 0) {
      throw new Response('wait for current file operations and uploads to finish before migrating storage', { status: 409 })
    }
  }

  private async prepareDestination(config: StorageConfig) {
    const destination = await this.buildStore(config)
    try {
      await destination.initialize()
      await destination.writable()
      return destination
    } catch (error) {
      throw new Response(`storage is not reachable or not writable: ${message(error)}`, { status: 400 })
    }
  }

  private async retryTransient<T>(migration: StorageMigration, event: RetryEvent, operation: () => Promise<T>) {
    return await pRetry(
      async () => {
        try {
          return await operation()
        } catch (error) {
          if (error instanceof Error) throw error
          if (error instanceof Response) {
            throw Object.assign(new Error((await error.text()) || error.statusText || 'storage operation failed', { cause: error }), {
              status: error.status,
            })
          }
          throw new Error(String(error), { cause: error })
        }
      },
      {
        retries: Number.POSITIVE_INFINITY,
        ...this.retryBackoff,
        shouldRetry: ({ error }) => isRetryableStorageError(error),
        onFailedAttempt: async ({ error, attemptNumber, retryDelay }) => {
          if (await this.cancelRequested(migration.id)) throw new MigrationCancelled()
          logger.warn(
            { err: error, event, attempt_number: attemptNumber, retry_delay_ms: retryDelay },
            'storage migration operation failed; retrying',
          )
        },
      },
    )
  }

  private async update(migration: StorageMigration) {
    this.assertLease()
    const current = await this.status()
    if (this.migrationOwnerId && (current?.id !== migration.id || current.ownerId !== this.migrationOwnerId)) {
      throw new WorkLeaseLost('storage migration ownership changed')
    }
    const next = { ...(current?.id === migration.id ? current : {}), ...migration, updatedAt: Date.now() }
    await this.repository.setSetting(STORAGE_MIGRATION_SETTING, next)
    return next
  }

  private async acquireLease(required: boolean): Promise<MigrationLease | undefined> {
    if (!this.distributed) return undefined
    const ownerId = crypto.randomUUID()
    const lease = await acquireWorkLease(this.distributed.workLocker, `storage-migration:${this.distributed.lockId}`, false)
    if (!lease) {
      if (required) throw new Response('a storage migration is already running on another replica', { status: 409 })
      return undefined
    }
    return { ...lease, ownerId, release: async () => await lease.release().catch(() => undefined) }
  }

  private assertLease() {
    this.migrationSignal?.throwIfAborted()
  }

  private async assertOwnership(migrationId: string) {
    this.assertLease()
    if (!this.migrationOwnerId) return
    const current = await this.status()
    if (current?.id !== migrationId || current.ownerId !== this.migrationOwnerId) {
      throw new WorkLeaseLost('storage migration ownership changed')
    }
  }
}

async function assetPaths(repository: Repository, source?: AssetStore) {
  const paths = (await repository.listRequests()).flatMap(requestAssetPaths)
  if (source) {
    const inventory = await source.inventory({ maxEntries: Number.POSITIVE_INFINITY })
    if (inventory.truncated) throw new Error('source storage inventory is incomplete')
    paths.push(...inventory.entries.filter((entry) => entry.type === 'file').map((entry) => entry.path))
  }
  return [...new Set(paths)].sort()
}

function message(error: unknown) {
  if (error instanceof Response) return error.statusText || 'storage migration failed'
  return error instanceof Error ? error.message : String(error)
}

function httpStatus(error: unknown) {
  const candidate = error as { status?: number; $metadata?: { httpStatusCode?: number } }
  return candidate.$metadata?.httpStatusCode ?? candidate.status
}

function isRetryableStorageError(error: unknown) {
  const candidate = error as {
    code?: string
    retryable?: boolean
    status?: number
    $metadata?: { httpStatusCode?: number }
    cause?: { code?: string }
  }
  const status = httpStatus(error)
  if (status !== undefined) return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
  const code = candidate.code ?? candidate.cause?.code
  return (
    isRetryableError(error) ||
    candidate.retryable === true ||
    (error instanceof TypeError && (error.message === 'fetch failed' || error.message === 'terminated')) ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENETUNREACH' ||
    code === 'EHOSTUNREACH' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
  )
}
