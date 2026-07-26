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

    const candidate = await this.buildStore(destination)
    try {
      await candidate.initialize()
      await candidate.writable()
    } catch (error) {
      throw new Response(`storage is not reachable or not writable: ${message(error)}`, { status: 400 })
    }

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
      return await this.startMigration(migration.destination, migration.purpose, migration.clearDestination)
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
        const failed: StorageMigration = {
          ...migration,
          ...(await this.status()),
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
      if (!this.clearDestination) throw new Error('destination clearing is unavailable')
      await this.clearDestination(initial.destination)
      initial = await this.update({ ...initial, phase: 'copying' })
      destination = await this.buildStore(initial.destination)
    }
    await destination.initialize()
    await destination.writable()

    if (await this.cancelRequested(initial.id)) return await this.finishCancelled(initial)

    const paths = await assetPaths(this.repository)
    const sizes = new Map<string, number>()
    let totalBytes = 0
    for (const relativePath of paths) {
      const source = await this.source.stat(relativePath)
      const existing = source ? undefined : await destination.stat(relativePath)
      const size = source?.size ?? (initial.purpose === 'legacy-namespace' ? existing?.size : undefined)
      if (size === undefined) throw new Error('source asset is missing')
      sizes.set(relativePath, size)
      totalBytes += size
    }

    let migration = await this.update({ ...initial, totalFiles: paths.length, totalBytes, copiedFiles: 0, copiedBytes: 0 })
    for (const relativePath of paths) {
      if (await this.cancelRequested(migration.id)) return await this.finishCancelled(migration)
      const size = sizes.get(relativePath)!
      migration = await this.update({ ...migration, currentPath: relativePath })
      const existing = await destination.stat(relativePath)
      if (existing && existing.size !== size) throw new Error('destination asset has a different size')
      if (!existing) {
        await pRetry(
          async () => {
            const source = await this.source.read(relativePath)
            if (source.size !== size) throw new Error('source asset changed while copying')
            await destination.writeStream(relativePath, source.stream, size)
          },
          {
            retries: 3,
            minTimeout: 500,
            maxTimeout: 4_000,
            shouldRetry: ({ error }) => isRetryableError(error),
            onFailedAttempt: ({ error, attemptNumber, retriesLeft }) =>
              logger.warn(
                {
                  err: error,
                  event: 'storage_migration_copy_retry',
                  attempt_number: attemptNumber,
                  retries_left: retriesLeft,
                },
                'storage migration copy attempt failed; retrying',
              ),
          },
        )
        const copied = await destination.stat(relativePath)
        if (!copied || copied.size !== size) throw new Error('destination verification failed')
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
