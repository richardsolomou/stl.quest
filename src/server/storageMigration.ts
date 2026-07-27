import crypto from 'node:crypto'
import pRetry from 'p-retry'
import { isRetryableError } from '../adapters/retryableError'
import type { AssetStore, Repository, StorageConfig, StorageMigration, Telemetry } from '../core/types'
import type { AssetGenerationQueue } from './assets/queue'
import { encryptSetting } from './integrations'
import { logger } from './logger'

export const STORAGE_MIGRATION_SETTING = 'storage-migration'
export const LEGACY_STORAGE_NAMESPACE_SETTING = 'legacy-storage-namespace'

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

export class StorageMigrationCoordinator {
  private running?: Promise<void>
  private assetsLocked = false

  constructor(
    private repository: Repository,
    private source: AssetStore,
    private sourceConfig: StorageConfig,
    private queue: AssetGenerationQueue,
    private buildStore: BuildStore,
    private activate: Activate,
    private telemetry: Telemetry,
    private clearDestination?: ClearDestination,
    private retryBackoff = DEFAULT_RETRY_BACKOFF,
  ) {}

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
    if (JSON.stringify(destination) === JSON.stringify(this.sourceConfig))
      throw new Response('choose a different storage location', { status: 400 })
    return await this.withAssetsLocked(async () => await this.startMigration(destination, undefined, clearDestination))
  }

  async startLegacyNamespace(destination: StorageConfig) {
    return await this.withAssetsLocked(async () => await this.startMigration(destination, 'legacy-namespace'))
  }

  private async startMigration(destination: StorageConfig, purpose?: StorageMigration['purpose'], clearDestination = false) {
    if (JSON.stringify(destination) === JSON.stringify(this.sourceConfig))
      throw new Response('choose a different storage location', { status: 400 })
    await this.assertReadyToStart()

    const candidate = await this.prepareDestination(destination)

    const now = Date.now()
    const migration: StorageMigration = {
      id: crypto.randomUUID(),
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
    this.launch(migration, candidate)
    return migration
  }

  async retry() {
    return await this.withAssetsLocked(async () => {
      const migration = await this.status()
      if (!migration || migration.state !== 'failed') throw new Response('there is no failed storage migration to retry', { status: 409 })
      await this.assertReadyToStart()
      const destination = await this.buildStore(migration.destination)
      const retried = await this.update({
        ...migration,
        state: 'running',
        phase: migration.phase ?? 'copying',
        error: undefined,
        finishedAt: undefined,
        cancelRequestedAt: undefined,
      })
      this.launch(retried, destination)
      return retried
    })
  }

  async cancel() {
    const migration = await this.status()
    if (!migration || migration.state !== 'running') throw new Response('there is no running storage migration to cancel', { status: 409 })
    if (migration.cancelRequestedAt) return migration
    return await this.update({ ...migration, cancelRequestedAt: Date.now() })
  }

  async resume() {
    const migration = await this.status()
    if (!migration || migration.state !== 'running') return
    this.launch(migration, await this.buildStore(migration.destination))
  }

  async waitForIdle() {
    await this.running
  }

  private launch(migration: StorageMigration, destination: AssetStore) {
    if (this.running) return
    this.running = this.run(migration, destination)
      .catch(async (error) => {
        const current = await this.status()
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
        logger.error({ err: error, event: 'storage_migration_failed', migration_id: migration.id }, 'storage migration failed')
        void this.telemetry
          .capture('server', 'storage_migration_failed', { adapter: migration.destination.adapter, files_copied: migration.copiedFiles })
          .catch(() => undefined)
        await this.activate()
      })
      .finally(() => {
        this.running = undefined
      })
  }

  private async run(initial: StorageMigration, destination: AssetStore) {
    await this.queue.shutdown()
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

    const paths = await assetPaths(this.repository)
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
        if (migration.destination.adapter === 'webdav' && httpStatus(error) === 413) {
          const cloudflare = (error as { cloudflare?: boolean }).cloudflare === true
          throw new Error(
            cloudflare
              ? `Cloudflare rejected ${relativePath} (${formatBytes(size)}) because it exceeds the plan upload limit. Switch the WebDAV endpoint to Tailscale Funnel using the WebDAV setup guide, then retry the migration.`
              : `WebDAV rejected ${relativePath} (${formatBytes(size)}) because it exceeds the server or proxy upload limit. Increase the limit or use a direct endpoint such as Tailscale Funnel, then retry the migration.`,
            { cause: error },
          )
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
    await this.repository.setSettings(
      {
        storageEncrypted: encryptSetting(activeStorage),
        [STORAGE_MIGRATION_SETTING]: completed,
        ...(completed.purpose === 'legacy-namespace' ? { [LEGACY_STORAGE_NAMESPACE_SETTING]: true } : {}),
      },
      ['storage'],
    )
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
    await this.repository.setSetting(STORAGE_MIGRATION_SETTING, cancelled)
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
    return await pRetry(operation, {
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
    })
  }

  private async update(migration: StorageMigration) {
    const current = await this.status()
    const next = { ...(current?.id === migration.id ? current : {}), ...migration, updatedAt: Date.now() }
    await this.repository.setSetting(STORAGE_MIGRATION_SETTING, next)
    return next
  }
}

async function assetPaths(repository: Repository) {
  return [
    ...new Set((await repository.listRequests()).flatMap((request) => [request.filePath, request.thumbnailPath, request.previewPath])),
  ]
    .filter((path): path is string => !!path)
    .sort()
}

function message(error: unknown) {
  if (error instanceof Response) return error.statusText || 'storage migration failed'
  return error instanceof Error ? error.message : String(error)
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1_000 && unit < units.length - 1) {
    value /= 1_000
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
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
