import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAssetStore } from '../adapters/filesystem'
import type { PrintRequest, Repository, StorageConfig, StorageMigration, Telemetry } from '../core/types'
import { STORAGE_MIGRATION_SETTING, StorageMigrationCoordinator } from './storageMigration'

const telemetry: Telemetry = { capture: async () => undefined, exception: async () => undefined }

describe('StorageMigrationCoordinator', () => {
  let sourceRoot: string
  let destinationRoot: string
  let source: LocalAssetStore

  beforeEach(async () => {
    sourceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-migration-source-'))
    destinationRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-migration-destination-'))
    source = new LocalAssetStore(sourceRoot)
    await source.initialize()
  })

  afterEach(async () => {
    await Promise.all([
      fs.promises.rm(sourceRoot, { recursive: true, force: true }),
      fs.promises.rm(destinationRoot, { recursive: true, force: true }),
    ])
  })

  it('copies every referenced asset, retains the source, and switches storage after verification', async () => {
    const paths = ['todo/model.stl', '.stlquest/thumbnails/model.png', '.stlquest/previews/model.glb']
    await Promise.all(paths.map((assetPath, index) => source.write(assetPath, new TextEncoder().encode(`asset-${index}`))))
    const repository = migrationRepository(request(paths))
    const activate = vi.fn(async () => undefined)
    const coordinator = new StorageMigrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      (config) => new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root),
      activate,
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    let mutationError: unknown
    try {
      coordinator.assertAssetsMutable()
    } catch (error) {
      mutationError = error
    }
    expect(mutationError).toBeInstanceOf(Response)
    expect((mutationError as Response).status).toBe(423)
    await vi.waitFor(() => expect(repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)?.state).toBe('completed'))

    for (const assetPath of paths) {
      expect(await fs.promises.readFile(source.absolute(assetPath), 'utf8')).toMatch(/^asset-/)
      expect(await fs.promises.readFile(path.join(destinationRoot, assetPath), 'utf8')).toMatch(/^asset-/)
    }
    expect(repository.getSetting<StorageConfig>('storage')).toEqual({ adapter: 'local', root: destinationRoot })
    expect(activate).toHaveBeenCalledOnce()
  })

  it('keeps the source active when a referenced asset is missing', async () => {
    const repository = migrationRepository(request(['todo/missing.stl']))
    const activate = vi.fn(async () => undefined)
    const coordinator = new StorageMigrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      (config) => new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root),
      activate,
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(() => expect(repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)?.state).toBe('failed'))

    expect(repository.getSetting<StorageConfig>('storage')).toBeUndefined()
    expect(repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)?.error).toContain('source asset is missing')
    expect(activate).toHaveBeenCalledOnce()
  })

  it('reopens the source stream after a retryable S3 upload failure', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    const writeStream = vi.spyOn(destination, 'writeStream').mockRejectedValueOnce(
      Object.assign(new Error('internal incident'), {
        name: 'InternalError',
        $metadata: { httpStatusCode: 500 },
      }),
    )
    const read = vi.spyOn(source, 'read')
    const coordinator = new StorageMigrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(() => expect(repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)?.state).toBe('completed'), {
      timeout: 3_000,
    })

    expect(writeStream).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenCalledTimes(2)
    expect(await fs.promises.readFile(path.join(destinationRoot, 'todo/model.stl'), 'utf8')).toBe('model')
  })

  it('resumes a persisted migration and skips assets already copied before restart', async () => {
    const paths = ['todo/copied.stl', 'todo/remaining.stl']
    await source.write(paths[0], new TextEncoder().encode('copied'))
    await source.write(paths[1], new TextEncoder().encode('remaining'))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    await destination.write(paths[0], new TextEncoder().encode('copied'))
    const repository = migrationRepository(request(paths))
    const now = Date.now()
    repository.setSetting(STORAGE_MIGRATION_SETTING, {
      id: 'persisted-migration',
      state: 'running',
      source: { adapter: 'local', root: sourceRoot },
      destination: { adapter: 'local', root: destinationRoot },
      totalFiles: 2,
      totalBytes: 15,
      copiedFiles: 1,
      copiedBytes: 6,
      startedAt: now,
      updatedAt: now,
    } satisfies StorageMigration)
    const writeStream = vi.spyOn(destination, 'writeStream')
    const coordinator = new StorageMigrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    coordinator.resume()
    await vi.waitFor(() => expect(repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)?.state).toBe('completed'))

    expect(writeStream).toHaveBeenCalledOnce()
    expect(await fs.promises.readFile(path.join(destinationRoot, paths[1]), 'utf8')).toBe('remaining')
  })

  it('retries a failed migration using its stored destination configuration', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const now = Date.now()
    repository.setSetting(STORAGE_MIGRATION_SETTING, {
      id: 'failed-migration',
      state: 'failed',
      source: { adapter: 'local', root: sourceRoot },
      destination: { adapter: 'local', root: destinationRoot },
      totalFiles: 1,
      totalBytes: 5,
      copiedFiles: 0,
      copiedBytes: 0,
      error: 'internal incident',
      startedAt: now,
      updatedAt: now,
      finishedAt: now,
    } satisfies StorageMigration)
    const coordinator = new StorageMigrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      (config) => new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root),
      vi.fn(async () => undefined),
      telemetry,
    )

    const retried = await coordinator.retry()
    expect(retried.id).not.toBe('failed-migration')
    await vi.waitFor(() => expect(repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)?.state).toBe('completed'))
    expect(await fs.promises.readFile(path.join(destinationRoot, 'todo/model.stl'), 'utf8')).toBe('model')
  })

  it('cancels before copying the first asset and keeps the source active', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    let releaseQueue!: () => void
    const queueBlocked = new Promise<void>((resolve) => {
      releaseQueue = resolve
    })
    const activate = vi.fn(async () => undefined)
    const coordinator = new StorageMigrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(() => queueBlocked) } as never,
      (config) => new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root),
      activate,
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    coordinator.cancel()
    releaseQueue()
    await vi.waitFor(() => expect(repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)?.state).toBe('cancelled'))

    expect(repository.getSetting<StorageConfig>('storage')).toBeUndefined()
    await expect(fs.promises.stat(path.join(destinationRoot, 'todo/model.stl'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(activate).toHaveBeenCalledOnce()
  })

  it('finishes the current asset after cancellation and stops before the next one', async () => {
    const paths = ['todo/first.stl', 'todo/second.stl']
    await source.write(paths[0], new TextEncoder().encode('first'))
    await source.write(paths[1], new TextEncoder().encode('second'))
    const repository = migrationRepository(request(paths))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    const writeStream = destination.writeStream.bind(destination)
    let releaseCopy!: () => void
    let markCopyStarted!: () => void
    const copyBlocked = new Promise<void>((resolve) => {
      releaseCopy = resolve
    })
    const copyStarted = new Promise<void>((resolve) => {
      markCopyStarted = resolve
    })
    vi.spyOn(destination, 'writeStream').mockImplementationOnce(async (...args) => {
      markCopyStarted()
      await copyBlocked
      return writeStream(...args)
    })
    const activate = vi.fn(async () => undefined)
    const coordinator = new StorageMigrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      () => destination,
      activate,
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await copyStarted
    coordinator.cancel()
    releaseCopy()
    await vi.waitFor(() => expect(repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)?.state).toBe('cancelled'))

    expect(await fs.promises.readFile(path.join(destinationRoot, paths[0]), 'utf8')).toBe('first')
    await expect(fs.promises.stat(path.join(destinationRoot, paths[1]))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(repository.getSetting<StorageConfig>('storage')).toBeUndefined()
    expect(repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING)?.copiedFiles).toBe(1)
    expect(activate).toHaveBeenCalledOnce()
  })
})

function request([filePath, thumbnailPath, previewPath]: string[]) {
  return { filePath, thumbnailPath, previewPath } as PrintRequest
}

function migrationRepository(printRequest: PrintRequest) {
  const settings = new Map<string, unknown>()
  return {
    listRequests: () => [printRequest],
    listOperations: () => [],
    activeUploadIds: () => new Set<string>(),
    getSetting: <T>(key: string) => settings.get(key) as T | undefined,
    setSetting: (key: string, value: unknown) => settings.set(key, value),
    setSettings: (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) settings.set(key, value)
    },
    deleteSetting: (key: string) => settings.delete(key),
  } as unknown as Repository
}
