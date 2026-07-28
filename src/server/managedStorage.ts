import path from 'node:path'
import type { AssetStore, Repository, StorageConfig, UploadStagingArea } from '../core/types'
import { S3AssetStore } from '../adapters/s3'
import { withWorkLease, type WorkLocker } from './workLock'
import { hostedDeployment } from './hosted'

export const MANAGED_STORAGE_QUOTA_BYTES = 1_000_000_000

type ManagedStorageConfig = Extract<StorageConfig, { adapter: 's3' }>

export function resolveManagedStorageConfig(workspaceId: string): ManagedStorageConfig | undefined {
  const bucket = process.env.STLQUEST_HOSTED_STORAGE_BUCKET?.trim()
  const endpoint = process.env.STLQUEST_HOSTED_STORAGE_ENDPOINT?.trim()
  const accessKeyId = process.env.STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY?.trim()
  const configured = [bucket, endpoint, accessKeyId, secretAccessKey].filter(Boolean).length
  if (!configured) return undefined
  if (configured !== 4) throw new Error('managed storage requires bucket, endpoint, access key ID, and secret access key')
  const basePrefix = process.env.STLQUEST_HOSTED_STORAGE_PREFIX?.trim().replace(/^\/+|\/+$/g, '')
  return {
    adapter: 's3',
    bucket: bucket!,
    endpoint: endpoint!,
    region: process.env.STLQUEST_HOSTED_STORAGE_REGION?.trim() || 'auto',
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    forcePathStyle: process.env.STLQUEST_HOSTED_STORAGE_FORCE_PATH_STYLE?.trim() === 'true',
    prefix: [basePrefix, 'workspaces', workspaceId].filter(Boolean).join('/'),
  }
}

export function managedStorageAvailable() {
  return hostedDeployment() && resolveManagedStorageConfig('probe') !== undefined
}

export class QuotaAssetStore implements AssetStore {
  private pending = Promise.resolve()

  constructor(
    private readonly store: AssetStore,
    private readonly lockId: string,
    private readonly repository: Pick<
      Repository,
      | 'reconcileManagedStorageUsage'
      | 'reserveManagedAssetBytes'
      | 'finishManagedAssetReservation'
      | 'beginManagedUploadFinalize'
      | 'finishManagedUploadFinalize'
    >,
    private readonly locker?: WorkLocker,
  ) {}

  async initialize() {
    await this.serial(async () => {
      await this.store.initialize()
      await this.repository.reconcileManagedStorageUsage((await this.store.inventory()).bytes)
    })
  }
  createPath = (requestId: string, originalFileName: string) => this.store.createPath(requestId, originalFileName)
  previewPath = (relativePath: string) => this.store.previewPath(relativePath)
  read = (relativePath: string) => this.store.read(relativePath)
  stat = (relativePath: string) => this.store.stat(relativePath)
  exists = (relativePath: string) => this.store.exists(relativePath)
  trashPath = (operationId: string, relativePath: string) => this.store.trashPath(operationId, relativePath)
  writable = () => this.store.writable()
  inventory = () => this.store.inventory()
  removeEmptyDirectory = (relativePath: string) => this.store.removeEmptyDirectory(relativePath)
  ensureMoved = (sourcePath: string, destinationPath: string) => this.store.ensureMoved(sourcePath, destinationPath)
  trash = (relativePath: string) => this.store.trash(relativePath)
  sweepTrash = () =>
    this.serial(async () => {
      await this.store.sweepTrash()
      await this.repository.reconcileManagedStorageUsage((await this.store.inventory()).bytes)
    })

  finalizeUpload(stagedPath: string, relativePath: string) {
    return this.finalizeUploadFrom(path.basename(stagedPath).replace(/\.part$/, ''), relativePath, (store) =>
      store.finalizeUpload(stagedPath, relativePath),
    )
  }

  /**
   * Converts an upload session's reservation into persisted usage around `publish`. The callback
   * receives the unmetered store on purpose: the bytes are already reserved, so a second
   * reservation would charge the same upload twice.
   */
  finalizeUploadFrom(uploadId: string, relativePath: string, publish: (store: AssetStore) => Promise<void>) {
    return this.serial(async () => {
      await this.repository.beginManagedUploadFinalize(uploadId)
      const before = await this.store.stat(relativePath)
      await publish(this.store)
      const after = await this.store.stat(relativePath)
      await this.repository.finishManagedUploadFinalize(uploadId, (after?.size ?? 0) - (before?.size ?? 0)).catch(async (error) => {
        await this.repository.reconcileManagedStorageUsage((await this.store.inventory()).bytes)
        throw error
      })
    })
  }

  write(relativePath: string, bytes: Uint8Array) {
    return this.serial(async () => {
      await this.writeWithQuota(relativePath, bytes.byteLength, () => this.store.write(relativePath, bytes))
    })
  }

  writeStream(relativePath: string, stream: ReadableStream, size: number) {
    return this.serial(async () => {
      await this.writeWithQuota(relativePath, size, () => this.store.writeStream(relativePath, stream, size))
    })
  }

  remove(relativePath: string) {
    return this.serial(async () => {
      const current = await this.store.stat(relativePath)
      await this.store.remove(relativePath)
      if (current)
        await this.repository.finishManagedAssetReservation(0, -current.size).catch(async (error) => {
          await this.repository.reconcileManagedStorageUsage((await this.store.inventory()).bytes)
          throw error
        })
    })
  }

  purgeTrash(trashPath: string) {
    return this.remove(trashPath)
  }

  clear(options?: { initialize?: boolean }) {
    return this.serial(async () => {
      await this.store.clear(options)
      await this.repository.reconcileManagedStorageUsage(0)
    })
  }

  private async writeWithQuota(relativePath: string, nextSize: number, write: () => Promise<void>) {
    const current = await this.store.stat(relativePath)
    const delta = nextSize - (current?.size ?? 0)
    const reserved = Math.max(0, delta)
    if (!(await this.repository.reserveManagedAssetBytes(reserved, MANAGED_STORAGE_QUOTA_BYTES))) {
      throw new Response('managed storage quota exceeded', { status: 413, statusText: 'managed storage quota exceeded' })
    }
    try {
      await write()
    } catch (error) {
      await this.repository.finishManagedAssetReservation(reserved, 0).catch(() => undefined)
      throw error
    }
    try {
      await this.repository.finishManagedAssetReservation(reserved, delta)
    } catch (error) {
      await this.repository.reconcileManagedStorageUsage((await this.store.inventory()).bytes)
      throw error
    }
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.pending
    let release!: () => void
    this.pending = new Promise<void>((resolve) => (release = resolve))
    await previous
    try {
      return await withWorkLease(this.locker, `managed-storage:${this.lockId}`, operation)
    } finally {
      release()
    }
  }
}

export function buildManagedAssetStore(workspaceId: string, repository: Repository, locker?: WorkLocker) {
  const config = resolveManagedStorageConfig(workspaceId)
  if (!config) throw new Error('managed storage is not configured for this deployment')
  return new QuotaAssetStore(new S3AssetStore(config), workspaceId, repository, locker)
}

/**
 * Accounts an upload finalization once, whichever staging area performs it. Local staging hands the
 * part to `AssetStore.finalizeUpload` while distributed staging streams it through `writeStream`, so
 * the quota conversion cannot live in the store alone — only the staging call knows an upload is
 * being published rather than an arbitrary asset written.
 */
export class QuotaUploadStaging implements UploadStagingArea {
  constructor(
    private readonly staging: UploadStagingArea,
    private readonly assets: QuotaAssetStore,
  ) {}

  initialize = () => this.staging.initialize()
  assertCapacity = (bytes: number) => this.staging.assertCapacity(bytes)
  uploadPart = (uploadId: string) => this.staging.uploadPart(uploadId)
  adoptUpload = (sourceRef: string, uploadId: string) => this.staging.adoptUpload(sourceRef, uploadId)
  size = (filePath: string) => this.staging.size(filePath)
  remove = (filePath: string) => this.staging.remove(filePath)
  writable = () => this.staging.writable()

  finalizeUpload(uploadId: string, stagedPath: string, destinationPath: string) {
    return this.assets.finalizeUploadFrom(uploadId, destinationPath, (store) =>
      this.staging.finalizeUpload(uploadId, stagedPath, destinationPath, store),
    )
  }
}
