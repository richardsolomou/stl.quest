import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AssetStore, StorageInventory, UploadStagingArea } from '../core/types'
import { MANAGED_STORAGE_QUOTA_BYTES, QuotaAssetStore, QuotaUploadStaging, resolveManagedStorageConfig } from './managedStorage'

afterEach(() => vi.unstubAllEnvs())

describe('managed storage', () => {
  it('keeps deployment credentials out of the workspace marker and namespaces every workspace', () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_BUCKET', 'models')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_ENDPOINT', 'https://account.r2.cloudflarestorage.com')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID', 'access')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY', 'secret')
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_PREFIX', 'hosted')

    expect(resolveManagedStorageConfig('workspace-id')).toEqual({
      adapter: 's3',
      bucket: 'models',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      region: 'auto',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      forcePathStyle: false,
      prefix: 'hosted/workspaces/workspace-id',
    })
  })

  it('rejects partial deployment configuration', () => {
    vi.stubEnv('STLQUEST_HOSTED_STORAGE_BUCKET', 'models')
    expect(() => resolveManagedStorageConfig('workspace-id')).toThrow('managed storage requires')
  })

  it('rejects generated assets that would exceed the shared 1 GB allowance', async () => {
    const write = vi.fn()
    const inventory: StorageInventory = {
      files: 1,
      folders: 0,
      bytes: MANAGED_STORAGE_QUOTA_BYTES,
      entries: [],
      truncated: false,
    }
    const backing = {
      inventory: async () => inventory,
      stat: async () => undefined,
      write,
    } as unknown as AssetStore
    const repository = {
      reconcileManagedStorageUsage: vi.fn(),
      reserveManagedAssetBytes: vi.fn().mockResolvedValue(false),
      finishManagedAssetReservation: vi.fn().mockResolvedValue(undefined),
      beginManagedUploadFinalize: vi.fn(),
      finishManagedUploadFinalize: vi.fn(),
    }
    const store = new QuotaAssetStore(backing, 'workspace-id', repository)

    // A real Error, not a thrown Response: the migration retry loop runs writes through p-retry,
    // which rejects with an opaque `TypeError: Non-error was thrown` when handed a non-Error.
    const rejection = await store.write('.stlquest/previews/model.bin', new Uint8Array([1])).catch((error) => error)
    expect(rejection).toBeInstanceOf(Error)
    expect(rejection).not.toBeInstanceOf(Response)
    expect(rejection).toMatchObject({ status: 413, message: 'managed storage quota exceeded' })
    expect(write).not.toHaveBeenCalled()
  })

  it('accounts for writes, overwrites, and removals', async () => {
    let size: number | undefined = 3
    const backing = {
      stat: async () => (size === undefined ? undefined : { size }),
      write: async (_path: string, bytes: Uint8Array) => {
        size = bytes.byteLength
      },
      remove: async () => {
        size = undefined
      },
    } as unknown as AssetStore
    const repository = {
      reconcileManagedStorageUsage: vi.fn(),
      reserveManagedAssetBytes: vi.fn().mockResolvedValue(true),
      finishManagedAssetReservation: vi.fn().mockResolvedValue(undefined),
      beginManagedUploadFinalize: vi.fn(),
      finishManagedUploadFinalize: vi.fn(),
    }
    const store = new QuotaAssetStore(backing, 'workspace-id', repository)

    await store.write('models/model.stl', new Uint8Array(5))
    await store.remove('models/model.stl')

    expect(repository.finishManagedAssetReservation.mock.calls).toEqual([
      [2, 2],
      [0, -5],
    ])
  })

  it('releases a reservation when the backing write fails', async () => {
    const backing = {
      stat: async () => undefined,
      write: async () => {
        throw new Error('storage unavailable')
      },
    } as unknown as AssetStore
    const repository = {
      reconcileManagedStorageUsage: vi.fn(),
      reserveManagedAssetBytes: vi.fn().mockResolvedValue(true),
      finishManagedAssetReservation: vi.fn().mockResolvedValue(undefined),
      beginManagedUploadFinalize: vi.fn(),
      finishManagedUploadFinalize: vi.fn(),
    }
    const store = new QuotaAssetStore(backing, 'workspace-id', repository)

    await expect(store.write('models/model.stl', new Uint8Array(4))).rejects.toThrow('storage unavailable')
    expect(repository.finishManagedAssetReservation).toHaveBeenCalledOnce()
    expect(repository.finishManagedAssetReservation).toHaveBeenCalledWith(4, 0)
  })

  it('reconciles an ambiguous accounting failure without releasing twice', async () => {
    const backing = {
      stat: async () => undefined,
      write: vi.fn(),
      inventory: async () => ({ files: 1, folders: 0, bytes: 4, entries: [], truncated: false }),
    } as unknown as AssetStore
    const repository = {
      reconcileManagedStorageUsage: vi.fn(),
      reserveManagedAssetBytes: vi.fn().mockResolvedValue(true),
      finishManagedAssetReservation: vi.fn().mockRejectedValue(new Error('database response lost')),
      beginManagedUploadFinalize: vi.fn(),
      finishManagedUploadFinalize: vi.fn(),
    }
    const store = new QuotaAssetStore(backing, 'workspace-id', repository)

    await expect(store.write('models/model.stl', new Uint8Array(4))).rejects.toThrow('database response lost')
    expect(repository.finishManagedAssetReservation).toHaveBeenCalledOnce()
    expect(repository.reconcileManagedStorageUsage).toHaveBeenCalledWith(4)
  })

  it('replays a written upload without counting the destination twice after a database failure', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'managed-replay-'))
    const staged = path.join(root, '00000000-0000-4000-8000-000000000001.part')
    await fs.promises.writeFile(staged, 'data')
    let destination = false
    const backing = {
      stat: async () => (destination ? { size: 4 } : undefined),
      finalizeUpload: async () => {
        destination = true
        await fs.promises.rm(staged, { force: true })
      },
      inventory: async () => ({ files: 1, folders: 0, bytes: 4, entries: [], truncated: false }),
    } as unknown as AssetStore
    const finish = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(undefined)
    const repository = {
      reconcileManagedStorageUsage: vi.fn(),
      reserveManagedAssetBytes: vi.fn(),
      finishManagedAssetReservation: vi.fn(),
      beginManagedUploadFinalize: vi.fn().mockResolvedValue(4),
      finishManagedUploadFinalize: finish,
    }
    const store = new QuotaAssetStore(backing, 'workspace-id', repository)

    await expect(store.finalizeUpload(staged, 'models/model.stl')).rejects.toThrow('database unavailable')
    await store.finalizeUpload(staged, 'models/model.stl')
    expect(finish).toHaveBeenLastCalledWith('00000000-0000-4000-8000-000000000001', 0)
    await fs.promises.rm(root, { recursive: true })
  })

  it('charges a streamed upload once when staging publishes it through writeStream', async () => {
    let destination: { size: number } | undefined
    const backing = {
      stat: async () => destination,
      writeStream: vi.fn(async (_path: string, _stream: ReadableStream, size: number) => {
        destination = { size }
      }),
      inventory: async () => ({ files: 1, folders: 0, bytes: 600, entries: [], truncated: false }),
    } as unknown as AssetStore
    const repository = {
      reconcileManagedStorageUsage: vi.fn(),
      reserveManagedAssetBytes: vi.fn().mockResolvedValue(true),
      finishManagedAssetReservation: vi.fn(),
      beginManagedUploadFinalize: vi.fn().mockResolvedValue(600),
      finishManagedUploadFinalize: vi.fn().mockResolvedValue(undefined),
    }
    const assets = new QuotaAssetStore(backing, 'workspace-id', repository)
    // Mirrors S3UploadStaging, which streams the staged part into the store rather than handing it
    // to AssetStore.finalizeUpload.
    const distributedStaging = {
      finalizeUpload: async (_uploadId: string, _staged: string, destinationPath: string, store: AssetStore) => {
        await store.writeStream(destinationPath, new ReadableStream(), 600)
      },
    } as unknown as UploadStagingArea
    const staging = new QuotaUploadStaging(distributedStaging, assets)

    await staging.finalizeUpload('upload-id', 'upload-id', 'models/model.stl')

    expect(repository.beginManagedUploadFinalize).toHaveBeenCalledWith('upload-id')
    expect(repository.reserveManagedAssetBytes).not.toHaveBeenCalled()
    expect(repository.finishManagedUploadFinalize).toHaveBeenCalledWith('upload-id', 600)
  })

  it('writes different assets concurrently but reconciles usage alone', async () => {
    let releaseFirst!: () => void
    const firstWrite = new Promise<void>((resolve) => (releaseFirst = resolve))
    const order: string[] = []
    const backing = {
      stat: async () => undefined,
      inventory: async () => ({ files: 0, folders: 0, bytes: 0, entries: [], truncated: false }),
      sweepTrash: vi.fn(),
      write: vi.fn(async (relativePath: string) => {
        order.push(`write:${relativePath}`)
        if (relativePath.endsWith('slow.bin')) await firstWrite
      }),
    } as unknown as AssetStore
    const repository = {
      reconcileManagedStorageUsage: vi.fn(async () => void order.push('reconcile')),
      reserveManagedAssetBytes: vi.fn().mockResolvedValue(true),
      finishManagedAssetReservation: vi.fn().mockResolvedValue(undefined),
      beginManagedUploadFinalize: vi.fn(),
      finishManagedUploadFinalize: vi.fn(),
    }
    const store = new QuotaAssetStore(backing, 'workspace-id', repository)

    const slow = store.write('.stlquest/previews/slow.bin', new Uint8Array([1]))
    await store.write('.stlquest/thumbnails/quick.png', new Uint8Array([1]))
    // The queue writes previews and thumbnails eight at a time; a slow write must not hold them up.
    expect(order).toEqual(['write:.stlquest/previews/slow.bin', 'write:.stlquest/thumbnails/quick.png'])

    const sweep = store.sweepTrash()
    expect(order).not.toContain('reconcile')
    releaseFirst()
    await Promise.all([slow, sweep])
    expect(order.at(-1)).toBe('reconcile')
  })

  it('uses one non-reentrant distributed lease layer for initialization and cleanup', async () => {
    let held = false
    let acquisitions = 0
    const locker = {
      newLock: () => ({
        lock: async () => {
          if (held) throw new Error('nested lease acquisition')
          held = true
          acquisitions++
        },
        unlock: async () => {
          held = false
        },
      }),
    }
    const backing = {
      initialize: vi.fn(),
      inventory: vi.fn().mockResolvedValue({ files: 0, folders: 0, bytes: 0, entries: [], truncated: false }),
      clear: vi.fn(),
    } as unknown as AssetStore
    const repository = {
      reconcileManagedStorageUsage: vi.fn(),
      reserveManagedAssetBytes: vi.fn(),
      finishManagedAssetReservation: vi.fn(),
      beginManagedUploadFinalize: vi.fn(),
      finishManagedUploadFinalize: vi.fn(),
    }
    const store = new QuotaAssetStore(backing, 'workspace-id', repository, locker)

    await store.initialize()
    await store.clear()
    expect(acquisitions).toBe(2)
  })
})
