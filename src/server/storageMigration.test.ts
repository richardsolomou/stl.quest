import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAssetStore } from '../adapters/filesystem'
import type { PrintRequest, Repository, StorageConfig, StorageMigration, Telemetry } from '../core/types'
import { decryptSetting, encryptSetting, type EncryptedSetting } from './integrations'
import { logger, setTelemetryExporters } from './logger'
import {
  LEGACY_STORAGE_NAMESPACE_SETTING,
  STORAGE_MIGRATION_SETTING,
  STORAGE_RUNTIME_REVISION_SETTING,
  StorageMigrationCoordinator,
  completeManagedStorageCleanup,
} from './storageMigration'
import { QuotaAssetStore } from './managedStorage'

const telemetry: Telemetry = { capture: async () => undefined, exception: async () => undefined }

describe('StorageMigrationCoordinator', () => {
  const dataDirectory = process.env.DATA_DIR
  let sourceRoot: string
  let destinationRoot: string
  let source: LocalAssetStore

  beforeEach(async () => {
    sourceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-migration-source-'))
    destinationRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-migration-destination-'))
    process.env.DATA_DIR = sourceRoot
    source = new LocalAssetStore(sourceRoot)
    await source.initialize()
  })

  afterEach(async () => {
    if (dataDirectory === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = dataDirectory
    await Promise.all([
      fs.promises.rm(sourceRoot, { recursive: true, force: true }),
      fs.promises.rm(destinationRoot, { recursive: true, force: true }),
    ])
  })

  it('copies every referenced asset, retains the source, and switches storage after verification', async () => {
    const paths = ['todo/model.stl', 'thumbnails/model.png', 'previews/model.glb']
    await Promise.all(paths.map((assetPath, index) => source.write(assetPath, new TextEncoder().encode(`asset-${index}`))))
    const repository = migrationRepository(request(paths))
    await repository.setSetting('storageEncrypted', encryptSetting({ adapter: 'local', root: sourceRoot }))
    const activate = vi.fn(async () => undefined)
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async (config) => new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root),
      activate,
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    let mutationError: unknown
    try {
      await coordinator.assertAssetsMutable()
    } catch (error) {
      mutationError = error
    }
    expect(mutationError).toBeInstanceOf(Response)
    expect((mutationError as Response).status).toBe(423)
    await vi.waitFor(async () =>
      expect((await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.state).toBe('completed'),
    )

    for (const assetPath of paths) {
      expect(await fs.promises.readFile(source.absolute(assetPath), 'utf8')).toMatch(/^asset-/)
      expect(await fs.promises.readFile(path.join(destinationRoot, assetPath), 'utf8')).toMatch(/^asset-/)
    }
    expect(decryptSetting((await repository.getSetting<EncryptedSetting>('storageEncrypted'))!)).toEqual({
      adapter: 'local',
      root: destinationRoot,
    })
    expect(await repository.getSetting('storage')).toBeUndefined()
    expect(await repository.getSetting(STORAGE_RUNTIME_REVISION_SETTING)).toEqual(expect.any(String))
    expect(activate).toHaveBeenCalledOnce()
  })

  it('clears managed source data before atomically releasing its entitlement', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const release = vi.spyOn(repository, 'setSettingsAndReleaseManagedStorage')
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'managed' },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => new LocalAssetStore(destinationRoot),
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await coordinator.waitForIdle()

    expect(await source.exists('todo/model.stl')).toBe(false)
    expect(release).toHaveBeenCalledOnce()
  })

  it('retains managed entitlement when source cleanup fails', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const release = vi.spyOn(repository, 'setSettingsAndReleaseManagedStorage')
    vi.spyOn(source, 'clear').mockRejectedValueOnce(new Error('managed cleanup unavailable'))
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'managed' },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => new LocalAssetStore(destinationRoot),
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await coordinator.waitForIdle()

    expect((await coordinator.status())?.state).toBe('completed')
    expect(release).not.toHaveBeenCalled()
    await completeManagedStorageCleanup(repository, source)
    expect(release).toHaveBeenCalledOnce()
  })

  it('leaves managed data alone when no cleanup is pending', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))

    await completeManagedStorageCleanup(repository, source)

    expect(await source.exists('todo/model.stl')).toBe(true)
  })

  it('allows only one replica to own a workspace migration', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    let held = false
    const workLocker = {
      newLock: () => ({
        lock: vi.fn(),
        tryLock: vi.fn(async () => {
          if (held) return false
          held = true
          return true
        }),
        unlock: vi.fn(async () => {
          held = false
        }),
      }),
    }
    let releaseQueue!: () => void
    const queueBlocked = new Promise<void>((resolve) => (releaseQueue = resolve))
    const build = async (config: StorageConfig) => new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root)
    const first = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(() => queueBlocked) } as never,
      build,
      vi.fn(async () => undefined),
      telemetry,
      undefined,
      undefined,
      { workLocker, lockId: 'workspace' },
    )
    const second = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      build,
      vi.fn(async () => undefined),
      telemetry,
      undefined,
      undefined,
      { workLocker, lockId: 'workspace' },
    )

    await first.start({ adapter: 'local', root: destinationRoot })
    await expect(second.start({ adapter: 'local', root: `${destinationRoot}-other` })).rejects.toMatchObject({ status: 409 })
    releaseQueue()
    await first.waitForIdle()
  })

  it('clears the selected folder before recreating the workspace destination', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    await fs.promises.mkdir(path.join(destinationRoot, 'old-workspace'), { recursive: true })
    await fs.promises.writeFile(path.join(destinationRoot, 'old-workspace', 'old.stl'), 'old')
    const workspaceRoot = path.join(destinationRoot, 'current-workspace')
    const repository = migrationRepository(request(['todo/model.stl']))
    let releaseClear!: () => void
    const clearBlocked = new Promise<void>((resolve) => {
      releaseClear = resolve
    })
    const buildStore = vi.fn(
      async (config: StorageConfig) => new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root),
    )
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      buildStore,
      vi.fn(async () => undefined),
      telemetry,
      async () => {
        await clearBlocked
        await new LocalAssetStore(destinationRoot).clear({ initialize: false })
      },
    )

    const migration = await coordinator.start({ adapter: 'local', root: workspaceRoot }, true)
    expect(migration.phase).toBe('clearing')
    expect((await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.phase).toBe('clearing')
    releaseClear()
    await vi.waitFor(async () =>
      expect((await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.state).toBe('completed'),
    )

    await expect(fs.promises.stat(path.join(destinationRoot, 'old-workspace'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.promises.readFile(path.join(workspaceRoot, 'todo/model.stl'), 'utf8')).resolves.toBe('model')
    await expect(fs.promises.readdir(destinationRoot)).resolves.toEqual(['current-workspace'])
    expect(buildStore).toHaveBeenCalledTimes(2)
  })

  it('does not prepare the active storage location', async () => {
    const repository = migrationRepository(request([]))
    const sourceConfig = { adapter: 'local', root: sourceRoot } as const
    const prepare = vi.fn(async () => undefined)
    const coordinator = migrationCoordinator(
      repository,
      source,
      sourceConfig,
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => source,
      vi.fn(async () => undefined),
      telemetry,
      prepare,
    )

    await expect(coordinator.start(sourceConfig, true)).rejects.toMatchObject({ status: 400 })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('records legacy namespace completion atomically with the storage switch', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const sourceConfig = { adapter: 'local', root: sourceRoot } as const
    await repository.setSetting('storageEncrypted', encryptSetting(sourceConfig))
    const coordinator = migrationCoordinator(
      repository,
      source,
      sourceConfig,
      { shutdown: vi.fn(async () => undefined) } as never,
      async (config) => new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root),
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.startLegacyNamespace({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(async () => expect(await repository.getSetting(LEGACY_STORAGE_NAMESPACE_SETTING)).toBe(true))

    expect(decryptSetting((await repository.getSetting<EncryptedSetting>('storageEncrypted'))!)).toEqual({
      adapter: 'local',
      root: sourceRoot,
    })
  })

  it('finishes a legacy namespace migration when an asset was already moved', async () => {
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    await destination.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.startLegacyNamespace({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(async () => expect(await repository.getSetting(LEGACY_STORAGE_NAMESPACE_SETTING)).toBe(true))

    expect((await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.state).toBe('completed')
  })

  it('keeps the source active when a referenced asset is missing', async () => {
    const repository = migrationRepository(request(['todo/missing.stl']))
    const sourceConfig = { adapter: 'local', root: sourceRoot } as const
    await repository.setSetting('storageEncrypted', encryptSetting(sourceConfig))
    const activate = vi.fn(async () => undefined)
    const coordinator = migrationCoordinator(
      repository,
      source,
      sourceConfig,
      { shutdown: vi.fn(async () => undefined) } as never,
      async (config) => new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root),
      activate,
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(async () => expect((await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.state).toBe('failed'))

    expect(await repository.getSetting<StorageConfig>('storage')).toBeUndefined()
    expect(decryptSetting((await repository.getSetting<EncryptedSetting>('storageEncrypted'))!)).toEqual(sourceConfig)
    expect((await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.error).toContain('source asset is missing')
    expect(activate).toHaveBeenCalledOnce()
  })

  it('keeps the source active when committing the completed switch fails', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const sourceConfig = { adapter: 'local', root: sourceRoot } as const
    await repository.setSetting('storageEncrypted', encryptSetting(sourceConfig))
    vi.spyOn(repository, 'setSettings').mockRejectedValueOnce(new Error('database unavailable'))
    const coordinator = migrationCoordinator(
      repository,
      source,
      sourceConfig,
      { shutdown: vi.fn(async () => undefined) } as never,
      async (config) => new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root),
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(async () => expect((await coordinator.status())?.state).toBe('failed'))

    expect(decryptSetting((await repository.getSetting<EncryptedSetting>('storageEncrypted'))!)).toEqual(sourceConfig)
  })

  it('blocks asset mutations while an empty workspace switches directly', async () => {
    const repository = migrationRepository(request([]))
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async (config) => new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root),
      vi.fn(async () => undefined),
      telemetry,
    )

    const switching = coordinator.withAssetsLocked(async () => await blocked)
    await vi.waitFor(async () => expect(await coordinator.active()).toBe(true))

    await expect(coordinator.assertAssetsMutable()).rejects.toMatchObject({ status: 423 })
    release()
    await switching
  })

  it('blocks direct storage switches while a migration is starting', async () => {
    const repository = migrationRepository(request([]))
    let releaseCandidate!: () => void
    let markCandidateStarted!: () => void
    const candidateBlocked = new Promise<void>((resolve) => {
      releaseCandidate = resolve
    })
    const candidateStarted = new Promise<void>((resolve) => {
      markCandidateStarted = resolve
    })
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async (config) => {
        markCandidateStarted()
        await candidateBlocked
        return new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root)
      },
      vi.fn(async () => undefined),
      telemetry,
    )

    const starting = coordinator.start({ adapter: 'local', root: destinationRoot })
    await candidateStarted

    await expect(coordinator.withAssetsLocked(async () => undefined)).rejects.toMatchObject({ status: 409 })
    releaseCandidate()
    await starting
    await coordinator.waitForIdle()
  })

  it('keeps retrying transient WebDAV upload failures until the copy succeeds', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    const writeStream = vi
      .spyOn(destination, 'writeStream')
      .mockRejectedValueOnce(Object.assign(new Error('Invalid response: 502 Bad Gateway'), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error('Invalid response: 502 Bad Gateway'), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error('Invalid response: 502 Bad Gateway'), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error('Invalid response: 502 Bad Gateway'), { status: 502 }))
    const read = vi.spyOn(source, 'read')
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
      undefined,
      { minTimeout: 0, maxTimeout: 0, randomize: false },
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await coordinator.waitForIdle()

    expect(writeStream).toHaveBeenCalledTimes(5)
    expect(read).toHaveBeenCalledTimes(5)
    expect(await fs.promises.readFile(path.join(destinationRoot, 'todo/model.stl'), 'utf8')).toBe('model')
  })

  it('does not retry permanent copy failures', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    const writeStream = vi
      .spyOn(destination, 'writeStream')
      .mockRejectedValue(Object.assign(new Error('Invalid response: 403 Forbidden'), { status: 403 }))
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(async () => expect((await coordinator.status())?.state).toBe('failed'))

    expect(writeStream).toHaveBeenCalledOnce()
  })

  it('preserves Response details from permanent copy failures', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    vi.spyOn(destination, 'writeStream').mockRejectedValue(
      new Response('managed storage quota exceeded', { status: 413, statusText: 'managed storage quota exceeded' }),
    )
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'managed' })
    await coordinator.waitForIdle()

    // A permanent 413 thrown as a Response is normalized (not crashed on) and surfaced as the
    // actionable managed-quota message rather than the raw statusText.
    expect((await coordinator.status())?.error).toBe(
      'Managed storage rejected todo/model.stl (5 B) because copying it would exceed your storage quota. Free up space or raise the quota, then retry the migration.',
    )
  })

  it('keeps retrying transient copy failures thrown as a Response until the copy succeeds', async () => {
    // Adapters throw raw `Response` objects (not Errors) for control flow. p-retry@8 turns a
    // thrown non-Error into a `TypeError('Non-error was thrown: "[object Response]"')` and never
    // consults `shouldRetry`, so a transient WebDAV response used to fail the migration with no
    // retry. `retryTransient` normalizes the Response to an Error carrying its status; this guards
    // that transient responses are retried rather than crashing the run.
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    const writeStream = vi
      .spyOn(destination, 'writeStream')
      .mockRejectedValueOnce(new Response('bad gateway', { status: 502, statusText: 'Bad Gateway' }))
      .mockRejectedValueOnce(new Response('service unavailable', { status: 503, statusText: 'Service Unavailable' }))
      .mockRejectedValueOnce(new Response('gateway timeout', { status: 504, statusText: 'Gateway Timeout' }))
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
      undefined,
      { minTimeout: 0, maxTimeout: 0, randomize: false },
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await coordinator.waitForIdle()

    expect(writeStream).toHaveBeenCalledTimes(4)
    expect((await coordinator.status())?.state).toBe('completed')
    expect(await fs.promises.readFile(path.join(destinationRoot, 'todo/model.stl'), 'utf8')).toBe('model')
  })

  it('retries transient destination inspection failures', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    const stat = vi
      .spyOn(destination, 'stat')
      .mockRejectedValueOnce(Object.assign(new Error('Invalid response: 502 Bad Gateway'), { status: 502 }))
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(async () => expect((await coordinator.status())?.state).toBe('completed'), { timeout: 3_000 })

    expect(stat).toHaveBeenCalledTimes(3)
  })

  it('keeps retrying transient source inspection failures', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const stat = vi
      .spyOn(source, 'stat')
      .mockRejectedValueOnce(Object.assign(new Error('Invalid response: 502 Bad Gateway'), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error('Invalid response: 502 Bad Gateway'), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error('Invalid response: 502 Bad Gateway'), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error('Invalid response: 502 Bad Gateway'), { status: 502 }))
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => new LocalAssetStore(destinationRoot),
      vi.fn(async () => undefined),
      telemetry,
      undefined,
      { minTimeout: 0, maxTimeout: 0, randomize: false },
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await coordinator.waitForIdle()

    expect(stat).toHaveBeenCalledTimes(5)
    expect((await coordinator.status())?.state).toBe('completed')
  })

  it('keeps retrying fetch-shaped network failures', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    const networkError = () => new TypeError('fetch failed', { cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }) })
    const writeStream = vi
      .spyOn(destination, 'writeStream')
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
      undefined,
      { minTimeout: 0, maxTimeout: 0, randomize: false },
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await coordinator.waitForIdle()

    expect(writeStream).toHaveBeenCalledTimes(5)
    expect((await coordinator.status())?.state).toBe('completed')
  })

  it('does not retry permanent server errors', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    const writeStream = vi
      .spyOn(destination, 'writeStream')
      .mockRejectedValue(Object.assign(new Error('Invalid response: 507 Insufficient Storage'), { status: 507 }))
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(async () => expect((await coordinator.status())?.state).toBe('failed'))

    expect(writeStream).toHaveBeenCalledOnce()
  })

  it('explains how to recover when WebDAV rejects an oversized file', async () => {
    await source.write('todo/large-model.stl', new Uint8Array(1_500_000))
    const repository = migrationRepository(request(['todo/large-model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    vi.spyOn(destination, 'writeStream').mockRejectedValue(
      Object.assign(new Error('Invalid response: 413 Payload Too Large'), { status: 413, cloudflare: true }),
    )
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({
      adapter: 'webdav',
      endpoint: 'https://storage.example.com/dav',
      root: 'stlquest',
      username: 'user',
      password: 'secret',
    })
    await coordinator.waitForIdle()

    expect((await coordinator.status())?.error).toBe(
      'Cloudflare rejected todo/large-model.stl (1.5 MB) because it exceeds the plan upload limit. Switch the WebDAV endpoint to Tailscale Funnel using the WebDAV setup guide, then retry the migration.',
    )
  })

  it('explains how to recover when managed storage rejects a file over quota', async () => {
    await source.write('todo/large-model.stl', new Uint8Array(1_500_000))
    const repository = migrationRepository(request(['todo/large-model.stl']))
    const backing = new LocalAssetStore(destinationRoot)
    await backing.initialize()
    // Exercise the real QuotaAssetStore: an over-quota reservation makes writeWithQuota throw, and it
    // must surface as an actionable failure — not the opaque `TypeError: Non-error was thrown` that a
    // thrown Response triggered inside p-retry.
    const quotaRepository = {
      reconcileManagedStorageUsage: vi.fn(),
      reserveManagedAssetBytes: vi.fn().mockResolvedValue(false),
      finishManagedAssetReservation: vi.fn().mockResolvedValue(undefined),
      beginManagedUploadFinalize: vi.fn(),
      finishManagedUploadFinalize: vi.fn(),
    }
    const destination = new QuotaAssetStore(backing, 'workspace-id', quotaRepository)
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'managed' })
    await coordinator.waitForIdle()

    expect((await coordinator.status())?.state).toBe('failed')
    expect((await coordinator.status())?.error).toBe(
      'Managed storage rejected todo/large-model.stl (1.5 MB) because copying it would exceed your storage quota. Free up space or raise the quota, then retry the migration.',
    )
  })

  it('does not route an over-quota managed failure into error tracking', async () => {
    // A migration that fails because the operator is over quota is expected and actionable, not an
    // application bug. It must still fire the storage_migration_failed telemetry event, but it must
    // not be logged with an `err` field — otherwise the level-50 pino hook (logger.ts) captures it as
    // a first-seen $exception and mints a fresh error-tracking issue on every over-quota migration.
    await source.write('todo/large-model.stl', new Uint8Array(1_500_000))
    const repository = migrationRepository(request(['todo/large-model.stl']))
    const backing = new LocalAssetStore(destinationRoot)
    await backing.initialize()
    const quotaRepository = {
      reconcileManagedStorageUsage: vi.fn(),
      reserveManagedAssetBytes: vi.fn().mockResolvedValue(false),
      finishManagedAssetReservation: vi.fn().mockResolvedValue(undefined),
      beginManagedUploadFinalize: vi.fn(),
      finishManagedUploadFinalize: vi.fn(),
    }
    const destination = new QuotaAssetStore(backing, 'workspace-id', quotaRepository)
    const exception = vi.fn()
    const capture = vi.fn(async () => undefined)
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const originalLevel = logger.level
    logger.level = 'error'
    setTelemetryExporters({ exception, log: vi.fn() })
    try {
      const coordinator = migrationCoordinator(
        repository,
        source,
        { adapter: 'local', root: sourceRoot },
        { shutdown: vi.fn(async () => undefined) } as never,
        async () => destination,
        vi.fn(async () => undefined),
        { capture, exception: async () => undefined },
      )

      await coordinator.start({ adapter: 'managed' })
      await coordinator.waitForIdle()

      expect((await coordinator.status())?.state).toBe('failed')
      // The failure is still recorded as telemetry, but never as an application exception.
      expect(capture).toHaveBeenCalledWith('server', 'storage_migration_failed', { adapter: 'managed', files_copied: 0 })
      expect(exception).not.toHaveBeenCalled()
    } finally {
      logger.level = originalLevel
      setTelemetryExporters(undefined)
      output.mockRestore()
    }
  })

  it('still routes an unexpected managed failure into error tracking', async () => {
    // Contrast with the over-quota case: a genuine, unexpected copy failure must keep its `err` field
    // so error tracking still surfaces real bugs.
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    vi.spyOn(destination, 'writeStream').mockRejectedValue(
      Object.assign(new Error('Insufficient Storage'), { $metadata: { httpStatusCode: 507 } }),
    )
    const exception = vi.fn()
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const originalLevel = logger.level
    logger.level = 'error'
    setTelemetryExporters({ exception, log: vi.fn() })
    try {
      const coordinator = migrationCoordinator(
        repository,
        source,
        { adapter: 'local', root: sourceRoot },
        { shutdown: vi.fn(async () => undefined) } as never,
        async () => destination,
        vi.fn(async () => undefined),
        telemetry,
      )

      await coordinator.start({ adapter: 'managed' })
      await coordinator.waitForIdle()

      expect((await coordinator.status())?.state).toBe('failed')
      expect(exception).toHaveBeenCalledOnce()
    } finally {
      logger.level = originalLevel
      setTelemetryExporters(undefined)
      output.mockRestore()
    }
  })

  it('does not retry permanent AWS server errors', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    const writeStream = vi
      .spyOn(destination, 'writeStream')
      .mockRejectedValue(Object.assign(new Error('Insufficient Storage'), { $metadata: { httpStatusCode: 507 } }))
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(async () => expect((await coordinator.status())?.state).toBe('failed'))

    expect(writeStream).toHaveBeenCalledOnce()
  })

  it('accepts a verified file after an ambiguous transient write failure', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    const write = destination.writeStream.bind(destination)
    const writeStream = vi.spyOn(destination, 'writeStream').mockImplementationOnce(async (...args) => {
      await write(...args)
      throw Object.assign(new Error('Invalid response: 502 Bad Gateway'), { status: 502 })
    })
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(async () => expect((await coordinator.status())?.state).toBe('completed'), { timeout: 3_000 })

    expect(writeStream).toHaveBeenCalledOnce()
  })

  it('can cancel while waiting to retry a transient copy failure', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    const writeStream = vi
      .spyOn(destination, 'writeStream')
      .mockRejectedValue(Object.assign(new Error('Invalid response: 502 Bad Gateway'), { status: 502 }))
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(() => expect(writeStream).toHaveBeenCalledOnce())
    await coordinator.cancel()
    await vi.waitFor(async () => expect((await coordinator.status())?.state).toBe('cancelled'), { timeout: 5_000 })
  })

  it('retries a transient WebDAV 502 from the destination instead of failing the run', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    // WebDAV errors carry the HTTP status on `.status`, not the AWS SDK's `$metadata.httpStatusCode`.
    const writeStream = vi.spyOn(destination, 'writeStream').mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(
      async () => expect((await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.state).toBe('completed'),
      {
        timeout: 3_000,
      },
    )

    expect(writeStream).toHaveBeenCalledTimes(2)
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
    await repository.setSetting(STORAGE_MIGRATION_SETTING, {
      id: 'persisted-migration',
      state: 'running',
      phase: 'copying',
      clearDestination: true,
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
    const clearDestination = vi.fn(async () => undefined)
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
      clearDestination,
    )

    await coordinator.resume()
    await vi.waitFor(async () =>
      expect((await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.state).toBe('completed'),
    )

    expect(writeStream).toHaveBeenCalledOnce()
    expect(clearDestination).not.toHaveBeenCalled()
    expect(await fs.promises.readFile(path.join(destinationRoot, paths[1]), 'utf8')).toBe('remaining')
  })

  it('does not overwrite a conflict after crashing before destination inspection', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('source'))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    await destination.write('todo/model.stl', new TextEncoder().encode('conflicting'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const now = Date.now()
    await repository.setSetting(STORAGE_MIGRATION_SETTING, {
      id: 'persisted-before-inspection',
      state: 'running',
      phase: 'copying',
      source: { adapter: 'local', root: sourceRoot },
      destination: { adapter: 'local', root: destinationRoot },
      totalFiles: 1,
      totalBytes: 6,
      copiedFiles: 0,
      copiedBytes: 0,
      currentPath: 'todo/model.stl',
      startedAt: now,
      updatedAt: now,
    } satisfies StorageMigration)
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.resume()
    await vi.waitFor(async () => expect((await coordinator.status())?.state).toBe('failed'))

    await expect(fs.promises.readFile(path.join(destinationRoot, 'todo/model.stl'), 'utf8')).resolves.toBe('conflicting')
  })

  it('does not overwrite a conflict after a failed write is retried', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('source'))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    const writeStream = vi.spyOn(destination, 'writeStream').mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }))
    const repository = migrationRepository(request(['todo/model.stl']))
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await vi.waitFor(async () => expect((await coordinator.status())?.state).toBe('failed'))
    await destination.write('todo/model.stl', new TextEncoder().encode('conflicting'))

    await coordinator.retry()
    await vi.waitFor(async () => expect((await coordinator.status())?.state).toBe('failed'))

    expect(writeStream).toHaveBeenCalledOnce()
    await expect(fs.promises.readFile(path.join(destinationRoot, 'todo/model.stl'), 'utf8')).resolves.toBe('conflicting')
  })

  it('retries a failed migration using its stored destination configuration', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const now = Date.now()
    await repository.setSetting(STORAGE_MIGRATION_SETTING, {
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
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async (config) => new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root),
      vi.fn(async () => undefined),
      telemetry,
    )

    const retried = await coordinator.retry()
    expect(retried.id).toBe('failed-migration')
    await vi.waitFor(async () =>
      expect((await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.state).toBe('completed'),
    )
    expect(await fs.promises.readFile(path.join(destinationRoot, 'todo/model.stl'), 'utf8')).toBe('model')
  })

  it('keeps retrying destination preparation after a manual retry', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const now = Date.now()
    await repository.setSetting(STORAGE_MIGRATION_SETTING, {
      id: 'failed-preparation-migration',
      state: 'failed',
      phase: 'copying',
      source: { adapter: 'local', root: sourceRoot },
      destination: { adapter: 'local', root: destinationRoot },
      totalFiles: 0,
      totalBytes: 0,
      copiedFiles: 0,
      copiedBytes: 0,
      error: 'permission was fixed',
      startedAt: now,
      updatedAt: now,
      finishedAt: now,
    } satisfies StorageMigration)
    const destination = new LocalAssetStore(destinationRoot)
    const initialize = vi
      .spyOn(destination, 'initialize')
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
      undefined,
      { minTimeout: 0, maxTimeout: 0, randomize: false },
    )

    const retried = await coordinator.retry()
    expect(retried.state).toBe('running')
    await coordinator.waitForIdle()

    expect(initialize).toHaveBeenCalledTimes(5)
    expect((await coordinator.status())?.state).toBe('completed')
  })

  it('retries a failed cleared migration without clearing verified files again', async () => {
    const paths = ['todo/copied.stl', 'todo/remaining.stl']
    await source.write(paths[0], new TextEncoder().encode('copied'))
    await source.write(paths[1], new TextEncoder().encode('remaining'))
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    await destination.write(paths[0], new TextEncoder().encode('copied'))
    const repository = migrationRepository(request(paths))
    const now = Date.now()
    await repository.setSetting(STORAGE_MIGRATION_SETTING, {
      id: 'failed-cleared-migration',
      state: 'failed',
      phase: 'copying',
      clearDestination: true,
      source: { adapter: 'local', root: sourceRoot },
      destination: { adapter: 'local', root: destinationRoot },
      totalFiles: 2,
      totalBytes: 15,
      copiedFiles: 1,
      copiedBytes: 6,
      error: 'Invalid response: 502 Bad Gateway',
      startedAt: now,
      updatedAt: now,
      finishedAt: now,
    } satisfies StorageMigration)
    const clearDestination = vi.fn(async () => undefined)
    const writeStream = vi.spyOn(destination, 'writeStream')
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
      clearDestination,
    )

    const retried = await coordinator.retry()
    expect(retried.id).toBe('failed-cleared-migration')
    await vi.waitFor(async () =>
      expect((await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.state).toBe('completed'),
    )

    expect(clearDestination).not.toHaveBeenCalled()
    expect(writeStream).toHaveBeenCalledOnce()
    await expect(fs.promises.readFile(path.join(destinationRoot, paths[0]), 'utf8')).resolves.toBe('copied')
  })

  it('retries destination clearing when the previous clearing phase failed', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    await fs.promises.writeFile(path.join(destinationRoot, 'stale.stl'), 'stale')
    const repository = migrationRepository(request(['todo/model.stl']))
    const now = Date.now()
    await repository.setSetting(STORAGE_MIGRATION_SETTING, {
      id: 'failed-clearing-migration',
      state: 'failed',
      phase: 'clearing',
      clearDestination: true,
      source: { adapter: 'local', root: sourceRoot },
      destination: { adapter: 'local', root: destinationRoot },
      totalFiles: 0,
      totalBytes: 0,
      copiedFiles: 0,
      copiedBytes: 0,
      error: 'destination clear failed',
      startedAt: now,
      updatedAt: now,
      finishedAt: now,
    } satisfies StorageMigration)
    const clearDestination = vi.fn(async () => {
      await new LocalAssetStore(destinationRoot).clear({ initialize: false })
    })
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => new LocalAssetStore(destinationRoot),
      vi.fn(async () => undefined),
      telemetry,
      clearDestination,
    )

    const retried = await coordinator.retry()
    expect(retried.phase).toBe('clearing')
    await vi.waitFor(async () => expect((await coordinator.status())?.state).toBe('completed'))

    expect(clearDestination).toHaveBeenCalledOnce()
    await expect(fs.promises.stat(path.join(destinationRoot, 'stale.stl'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.promises.readFile(path.join(destinationRoot, 'todo/model.stl'), 'utf8')).resolves.toBe('model')
  })

  it('keeps retrying transient destination clearing failures', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    await fs.promises.writeFile(path.join(destinationRoot, 'stale.stl'), 'stale')
    const repository = migrationRepository(request(['todo/model.stl']))
    const clearDestination = vi
      .fn(async () => await new LocalAssetStore(destinationRoot).clear({ initialize: false }))
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => new LocalAssetStore(destinationRoot),
      vi.fn(async () => undefined),
      telemetry,
      clearDestination,
      { minTimeout: 0, maxTimeout: 0, randomize: false },
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot }, true)
    await coordinator.waitForIdle()

    expect(clearDestination).toHaveBeenCalledTimes(5)
    expect((await coordinator.status())?.state).toBe('completed')
  })

  it('cancels before copying the first asset and keeps the source active', async () => {
    await source.write('todo/model.stl', new TextEncoder().encode('model'))
    const repository = migrationRepository(request(['todo/model.stl']))
    const sourceConfig = { adapter: 'local', root: sourceRoot } as const
    await repository.setSetting('storageEncrypted', encryptSetting(sourceConfig))
    let releaseQueue!: () => void
    const queueBlocked = new Promise<void>((resolve) => {
      releaseQueue = resolve
    })
    const activate = vi.fn(async () => undefined)
    const coordinator = migrationCoordinator(
      repository,
      source,
      sourceConfig,
      { shutdown: vi.fn(() => queueBlocked) } as never,
      async (config) => new LocalAssetStore((config as Extract<StorageConfig, { adapter: 'local' }>).root),
      activate,
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await coordinator.cancel()
    releaseQueue()
    await vi.waitFor(async () =>
      expect((await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.state).toBe('cancelled'),
    )

    expect(await repository.getSetting<StorageConfig>('storage')).toBeUndefined()
    expect(decryptSetting((await repository.getSetting<EncryptedSetting>('storageEncrypted'))!)).toEqual(sourceConfig)
    await expect(fs.promises.stat(path.join(destinationRoot, 'todo/model.stl'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(activate).toHaveBeenCalledOnce()
  })

  it('abandons a failed migration into managed storage and releases its entitlement after cleanup', async () => {
    const repository = migrationRepository(request([]))
    const migration: StorageMigration = {
      id: 'failed-managed',
      state: 'failed',
      phase: 'copying',
      source: { adapter: 'local', root: sourceRoot },
      destination: { adapter: 'managed' },
      totalFiles: 1,
      totalBytes: 5,
      copiedFiles: 1,
      copiedBytes: 5,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      error: 'copy failed',
    }
    await repository.setSetting(STORAGE_MIGRATION_SETTING, migration)
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    await destination.write('models/partial.stl', new TextEncoder().encode('model'))
    const release = vi.spyOn(repository, 'setSettingsAndReleaseManagedStorage')
    const coordinator = migrationCoordinator(
      repository,
      source,
      migration.source,
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await expect(coordinator.cancel()).resolves.toMatchObject({ state: 'cancelled' })
    expect(await destination.exists('models/partial.stl')).toBe(false)
    expect(release).toHaveBeenCalledOnce()
  })

  it('finishes abandoning a failed managed migration when cleanup resumes after restart', async () => {
    const repository = migrationRepository(request([]))
    const migration: StorageMigration = {
      id: 'failed-managed-cleanup',
      state: 'failed',
      source: { adapter: 'local', root: sourceRoot },
      destination: { adapter: 'managed' },
      totalFiles: 0,
      totalBytes: 0,
      copiedFiles: 0,
      copiedBytes: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      error: 'copy failed',
    }
    await repository.setSetting(STORAGE_MIGRATION_SETTING, migration)
    const destination = new LocalAssetStore(destinationRoot)
    await destination.initialize()
    vi.spyOn(destination, 'clear').mockRejectedValueOnce(new Error('cleanup unavailable'))
    const release = vi.spyOn(repository, 'setSettingsAndReleaseManagedStorage')
    const coordinator = migrationCoordinator(
      repository,
      source,
      migration.source,
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      vi.fn(async () => undefined),
      telemetry,
    )

    await expect(coordinator.cancel()).rejects.toThrow('cleanup unavailable')
    expect((await coordinator.status())?.state).toBe('failed')
    expect(release).not.toHaveBeenCalled()

    await completeManagedStorageCleanup(repository, destination)

    expect((await coordinator.status())?.state).toBe('cancelled')
    expect(release).toHaveBeenCalledOnce()
    await expect(coordinator.retry()).rejects.toMatchObject({ status: 409 })
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
    const coordinator = migrationCoordinator(
      repository,
      source,
      { adapter: 'local', root: sourceRoot },
      { shutdown: vi.fn(async () => undefined) } as never,
      async () => destination,
      activate,
      telemetry,
    )

    await coordinator.start({ adapter: 'local', root: destinationRoot })
    await copyStarted
    await coordinator.cancel()
    releaseCopy()
    await vi.waitFor(async () =>
      expect((await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.state).toBe('cancelled'),
    )

    expect(await fs.promises.readFile(path.join(destinationRoot, paths[0]), 'utf8')).toBe('first')
    await expect(fs.promises.stat(path.join(destinationRoot, paths[1]))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await repository.getSetting<StorageConfig>('storage')).toBeUndefined()
    expect((await repository.getSetting<StorageMigration>(STORAGE_MIGRATION_SETTING))?.copiedFiles).toBe(1)
    expect(activate).toHaveBeenCalledOnce()
  })
})

function request([filePath, thumbnailPath, previewPath]: string[]) {
  return { filePath, thumbnailPath, previewPath } as PrintRequest
}

type CoordinatorOptions = ConstructorParameters<typeof StorageMigrationCoordinator>[0]

function migrationCoordinator(
  repository: CoordinatorOptions['repository'],
  source: CoordinatorOptions['source'],
  sourceConfig: CoordinatorOptions['sourceConfig'],
  queue: CoordinatorOptions['queue'],
  buildStore: CoordinatorOptions['buildStore'],
  activate: CoordinatorOptions['activate'],
  coordinatorTelemetry: CoordinatorOptions['telemetry'],
  clearDestination?: CoordinatorOptions['clearDestination'],
  retryBackoff?: CoordinatorOptions['retryBackoff'],
  distributed?: CoordinatorOptions['distributed'],
) {
  return new StorageMigrationCoordinator({
    repository,
    source,
    sourceConfig,
    queue,
    buildStore,
    activate,
    telemetry: coordinatorTelemetry,
    clearDestination,
    retryBackoff,
    distributed,
  })
}

function migrationRepository(printRequest: PrintRequest) {
  const settings = new Map<string, unknown>()
  return {
    listRequests: () => [printRequest],
    listOperations: () => [],
    listAssetGenerationJobs: () => [],
    activeUploadIds: () => new Set<string>(),
    getSetting: async <T>(key: string) => (await settings.get(key)) as T | undefined,
    setSetting: (key: string, value: unknown) => settings.set(key, value),
    setSettings: (values: Record<string, unknown>, deleteKeys: string[] = []) => {
      for (const [key, value] of Object.entries(values)) settings.set(key, value)
      for (const key of deleteKeys) settings.delete(key)
    },
    setSettingsAndReleaseManagedStorage: (values: Record<string, unknown>, deleteKeys: string[] = []) => {
      for (const [key, value] of Object.entries(values)) settings.set(key, value)
      for (const key of deleteKeys) settings.delete(key)
    },
    deleteSetting: (key: string) => settings.delete(key),
  } as unknown as Repository
}
