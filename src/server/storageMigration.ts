import crypto from 'node:crypto'
import pRetry from 'p-retry'
import { isRetryableS3Error } from '../adapters/s3'
import type { AssetStore, Repository, StorageConfig, StorageMigration, Telemetry } from '../core/types'
import type { AssetGenerationQueue } from './assets/queue'
import { logger } from './logger'

export const STORAGE_MIGRATION_SETTING = 'storage-migration'

type BuildStore = (config: StorageConfig) => AssetStore
type Activate = () => Promise<void>

export class StorageMigrationCoordinator {
  private running?: Promise<void>

  constructor(
    private repository: Repository,
    private source: AssetStore,
    private sourceConfig: StorageConfig,
    private queue: AssetGenerationQueue,
    private buildStore: BuildStore,
    private activate: Activate,
    private telemetry: Telemetry,
  ) {}

  status() {
    return this.repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)
  }

  active() {
    return this.status()?.state === 'running'
  }

  assertAssetsMutable() {
    if (this.active()) throw new Response('storage migration is in progress; file changes are temporarily paused', { status: 423 })
  }

  async start(destination: StorageConfig) {
    if (this.active()) throw new Response('a storage migration is already in progress', { status: 409 })
    if (JSON.stringify(destination) === JSON.stringify(this.sourceConfig))
      throw new Response('choose a different storage location', { status: 400 })
    this.assertReadyToStart()

    const candidate = this.buildStore(destination)
    try {
      await candidate.initialize()
      await candidate.writable()
    } catch (error) {
      throw new Response(`storage is not reachable or not writable: ${message(error)}`, { status: 400 })
    }

    const now = Date.now()
    const migration: StorageMigration = {
      id: crypto.randomUUID(),
      state: 'running',
      source: this.sourceConfig,
      destination,
      totalFiles: 0,
      totalBytes: 0,
      copiedFiles: 0,
      copiedBytes: 0,
      startedAt: now,
      updatedAt: now,
    }
    this.repository.setSetting(STORAGE_MIGRATION_SETTING, migration)
    this.launch(migration, candidate)
    return migration
  }

  async retry() {
    const migration = this.status()
    if (!migration || migration.state !== 'failed') throw new Response('there is no failed storage migration to retry', { status: 409 })
    return this.start(migration.destination)
  }

  cancel() {
    const migration = this.status()
    if (!migration || migration.state !== 'running') throw new Response('there is no running storage migration to cancel', { status: 409 })
    if (migration.cancelRequestedAt) return migration
    return this.update({ ...migration, cancelRequestedAt: Date.now() })
  }

  resume() {
    const migration = this.status()
    if (!migration || migration.state !== 'running') return
    this.launch(migration, this.buildStore(migration.destination))
  }

  private launch(migration: StorageMigration, destination: AssetStore) {
    if (this.running) return
    this.running = this.run(migration, destination)
      .catch(async (error) => {
        const failed: StorageMigration = {
          ...migration,
          ...this.status(),
          state: 'failed',
          currentPath: undefined,
          error: message(error),
          updatedAt: Date.now(),
          finishedAt: Date.now(),
        }
        this.repository.setSetting(STORAGE_MIGRATION_SETTING, failed)
        logger.error({ err: error, migrationId: migration.id }, 'storage migration failed')
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
    this.assertReadyToStart()
    await destination.initialize()
    await destination.writable()

    if (this.cancelRequested(initial.id)) return this.finishCancelled(initial)

    const paths = assetPaths(this.repository)
    const sizes = new Map<string, number>()
    let totalBytes = 0
    for (const relativePath of paths) {
      const source = await this.source.stat(relativePath)
      if (!source) throw new Error(`source asset is missing: ${relativePath}`)
      sizes.set(relativePath, source.size)
      totalBytes += source.size
    }

    let migration = this.update({ ...initial, totalFiles: paths.length, totalBytes, copiedFiles: 0, copiedBytes: 0 })
    for (const relativePath of paths) {
      if (this.cancelRequested(migration.id)) return this.finishCancelled(migration)
      const size = sizes.get(relativePath)!
      migration = this.update({ ...migration, currentPath: relativePath })
      const existing = await destination.stat(relativePath)
      if (existing && existing.size !== size) throw new Error(`destination asset has a different size: ${relativePath}`)
      if (!existing) {
        await pRetry(
          async () => {
            const source = await this.source.read(relativePath)
            if (source.size !== size) throw new Error(`source asset changed while copying: ${relativePath}`)
            await destination.writeStream(relativePath, source.stream, size)
          },
          {
            retries: 3,
            minTimeout: 500,
            maxTimeout: 4_000,
            shouldRetry: ({ error }) => isRetryableS3Error(error),
            onFailedAttempt: ({ error, attemptNumber, retriesLeft }) =>
              logger.warn({ err: error, relativePath, attemptNumber, retriesLeft }, 'storage migration copy attempt failed; retrying'),
          },
        )
        const copied = await destination.stat(relativePath)
        if (!copied || copied.size !== size) throw new Error(`destination verification failed: ${relativePath}`)
      }
      migration = this.update({
        ...migration,
        copiedFiles: migration.copiedFiles + 1,
        copiedBytes: migration.copiedBytes + size,
        currentPath: undefined,
      })
      if (this.cancelRequested(migration.id)) return this.finishCancelled(migration)
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
    this.repository.setSettings({ storage: completed.destination, [STORAGE_MIGRATION_SETTING]: completed })
    logger.info({ migrationId: completed.id, files: completed.totalFiles, bytes: completed.totalBytes }, 'storage migration completed')
    void this.telemetry
      .capture('server', 'storage_migration_completed', {
        adapter: completed.destination.adapter,
        files: completed.totalFiles,
        bytes: completed.totalBytes,
      })
      .catch(() => undefined)
    await this.activate()
  }

  private cancelRequested(id: string) {
    const migration = this.status()
    return migration?.id === id && migration.state === 'running' && migration.cancelRequestedAt !== undefined
  }

  private async finishCancelled(migration: StorageMigration) {
    const finishedAt = Date.now()
    const cancelled: StorageMigration = {
      ...migration,
      ...this.status(),
      state: 'cancelled',
      currentPath: undefined,
      error: undefined,
      updatedAt: finishedAt,
      finishedAt,
    }
    this.repository.setSetting(STORAGE_MIGRATION_SETTING, cancelled)
    logger.info({ migrationId: cancelled.id, files: cancelled.copiedFiles, bytes: cancelled.copiedBytes }, 'storage migration cancelled')
    await this.activate()
  }

  private assertReadyToStart() {
    if (this.repository.listOperations().length > 0 || this.repository.activeUploadIds(Date.now()).size > 0) {
      throw new Response('wait for current file operations and uploads to finish before migrating storage', { status: 409 })
    }
  }

  private update(migration: StorageMigration) {
    const current = this.status()
    const next = { ...(current?.id === migration.id ? current : {}), ...migration, updatedAt: Date.now() }
    this.repository.setSetting(STORAGE_MIGRATION_SETTING, next)
    return next
  }
}

function assetPaths(repository: Repository) {
  return [...new Set(repository.listRequests().flatMap((request) => [request.filePath, request.thumbnailPath, request.previewPath]))]
    .filter((path): path is string => !!path)
    .sort()
}

function message(error: unknown) {
  if (error instanceof Response) return error.statusText || 'storage migration failed'
  return error instanceof Error ? error.message : String(error)
}
