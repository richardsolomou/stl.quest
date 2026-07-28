import { HeadBucketCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'
import { S3Store, type MetadataValue } from '@tus/s3-store'
import { IoRedisKvStore, type Lock, type Locker, type RequestRelease } from '@tus/server'
import Redis from 'ioredis'
import { Mutex } from 'redis-semaphore'
import { Readable } from 'node:stream'
import type { AssetStore, UploadStagingArea, UploadStore } from '../core/types'
import { isNotFound } from './s3'
import { UPLOAD_TTL } from './tus'

export type DistributedUploadConfig = {
  bucket: string
  region: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  forcePathStyle: boolean
}

export type DistributedUploadStorage = {
  datastore: S3Store
  staging: UploadStagingArea
  uploads: UploadStore
  locker: Locker
}

export function createDistributedUploadStorage(config: DistributedUploadConfig, redis: Redis): DistributedUploadStorage {
  const s3ClientConfig = resolveS3ClientConfig(config)
  const datastore = new S3Store({
    partSize: 8 * 1024 * 1024,
    minPartSize: 8 * 1024 * 1024,
    expirationPeriodInMilliseconds: UPLOAD_TTL,
    cache: new IoRedisKvStore<MetadataValue>(redis, 'stlquest:tus:metadata:'),
    s3ClientConfig: { ...s3ClientConfig, bucket: config.bucket },
  })
  const staging = new S3UploadStaging(datastore, new S3Client(s3ClientConfig), config.bucket)
  return {
    datastore,
    staging,
    uploads: staging,
    locker: new RedisLocker(redis, 'stlquest:tus:'),
  }
}

function resolveS3ClientConfig(config: DistributedUploadConfig): S3ClientConfig {
  const { endpoint, region, accessKeyId, secretAccessKey, forcePathStyle } = config
  return {
    region,
    endpoint,
    forcePathStyle,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  }
}

export class S3UploadStaging implements UploadStagingArea, UploadStore {
  constructor(
    private datastore: S3Store,
    private client: S3Client,
    private bucket: string,
  ) {}

  async initialize() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
  }

  async assertCapacity() {}

  uploadPart(uploadId: string) {
    return uploadId
  }

  async adoptUpload(sourceRef: string, uploadId: string) {
    if (sourceRef !== uploadId) throw new Error('distributed upload staging cannot adopt local files')
  }

  async finalizeUpload(_uploadId: string, stagedPath: string, destinationPath: string, assets: AssetStore) {
    const upload = await this.getUpload(stagedPath)
    const destination = await assets.stat(destinationPath)
    if (!upload) {
      if (destination) return
      throw Object.assign(new Error(`upload part missing: ${stagedPath}`), { code: 'ENOENT' })
    }
    const size = upload.size ?? upload.offset
    if (destination) {
      if (destination.size !== size) throw new Error(`upload destination already exists: ${destinationPath}`)
    } else {
      const stream = await this.datastore.read(stagedPath)
      await assets.writeStream(destinationPath, Readable.toWeb(stream) as ReadableStream, size)
    }
    await this.datastore.remove(stagedPath)
  }

  async size(stagedPath: string) {
    const upload = await this.getUpload(stagedPath)
    return upload?.offset ?? 0
  }

  async remove(stagedPath: string) {
    await this.datastore.remove(stagedPath)
  }

  async writable() {
    await this.initialize()
  }

  private async getUpload(stagedPath: string) {
    try {
      return await this.datastore.getUpload(stagedPath)
    } catch (error) {
      if (isMissingObject(error)) return undefined
      throw error
    }
  }
}

export const isMissingObject = isNotFound

export class RedisLocker implements Locker {
  constructor(
    private redis: Redis,
    private prefix: string,
  ) {}

  newLock(id: string): Lock {
    return new RedisLock(this.redis, `${this.prefix}${id}`)
  }
}

class RedisLock implements Lock {
  private mutex: Mutex | undefined

  constructor(
    private redis: Redis,
    private id: string,
  ) {}

  async lock(signal: AbortSignal, requestRelease: RequestRelease) {
    this.mutex = this.createMutex(requestRelease)
    await this.mutex.acquire(signal)
  }

  async tryLock(signal: AbortSignal, requestRelease: RequestRelease) {
    this.mutex = this.createMutex(requestRelease, 1)
    const acquired = await this.mutex.tryAcquire(signal)
    if (!acquired) this.mutex = undefined
    return acquired
  }

  private createMutex(requestRelease: RequestRelease, acquireAttemptsLimit?: number) {
    return new Mutex(this.redis, this.id, {
      lockTimeout: 30_000,
      acquireTimeout: 30_000,
      acquireAttemptsLimit,
      refreshInterval: 10_000,
      onLockLost: () => void requestRelease(),
    })
  }

  async unlock() {
    await this.mutex?.release()
    this.mutex = undefined
  }
}
