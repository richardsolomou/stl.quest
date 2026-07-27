import { HeadBucketCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'
import { S3Store, type MetadataValue } from '@tus/s3-store'
import { IoRedisKvStore, type Lock, type Locker, type RequestRelease } from '@tus/server'
import Redis from 'ioredis'
import { Mutex } from 'redis-semaphore'
import { Readable } from 'node:stream'
import type { AssetStore, UploadStagingArea, UploadStore } from '../core/types'
import type { DistributedConfig } from '../server/distributed'
import { UPLOAD_TTL } from './tus'
import { RedisEventHub } from './events'
import { DistributedBoardPresence } from './distributedPresence'

export type DistributedUploads = {
  datastore: S3Store
  staging: UploadStagingArea
  uploads: UploadStore
  locker: Locker
  workLocker: Locker
  events: RedisEventHub
  presence: DistributedBoardPresence
  close(): Promise<void>
}

export async function createDistributedUploads(
  config: DistributedConfig,
  onError: (error: unknown) => void = () => undefined,
): Promise<DistributedUploads> {
  const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 })
  redis.on('error', onError)
  await redis.connect()
  const s3ClientConfig = resolveS3ClientConfig(config)
  const datastore = new S3Store({
    partSize: 8 * 1024 * 1024,
    minPartSize: 8 * 1024 * 1024,
    expirationPeriodInMilliseconds: UPLOAD_TTL,
    cache: new IoRedisKvStore<MetadataValue>(redis, 'stlquest:tus:metadata:'),
    s3ClientConfig: { ...s3ClientConfig, bucket: config.staging.bucket },
  })
  const staging = new S3UploadStaging(datastore, new S3Client(s3ClientConfig), config.staging.bucket)
  const events = new RedisEventHub(redis, onError)
  const presence = new DistributedBoardPresence(redis, onError)
  return {
    datastore,
    staging,
    uploads: staging,
    locker: new RedisLocker(redis, 'stlquest:tus:'),
    workLocker: new RedisLocker(redis, 'stlquest:work:'),
    events,
    presence,
    close: async () => {
      await presence.close()
      await events.close()
      await redis.quit()
    },
  }
}

function resolveS3ClientConfig(config: DistributedConfig): S3ClientConfig {
  const { endpoint, region, accessKeyId, secretAccessKey, forcePathStyle } = config.staging
  return {
    region,
    endpoint,
    forcePathStyle,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  }
}

export class S3UploadStaging implements UploadStagingArea, UploadStore {
  readonly root = 's3://staging'

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

  async writeUploadPart() {
    throw new Error('distributed upload staging only accepts TUS uploads')
  }

  async copyUploadPart(sourcePath: string, filePath: string) {
    if (sourcePath !== filePath) throw new Error('distributed upload staging cannot copy local files')
  }

  async finalizeUpload(stagedPath: string, destinationPath: string, assets: AssetStore) {
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

  async sweepUploads() {}

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

function isMissingObject(error: unknown) {
  if (!error || typeof error !== 'object') return false
  if ('name' in error && (error.name === 'NoSuchKey' || error.name === 'NotFound')) return true
  return '$metadata' in error && (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 404
}

class RedisLocker implements Locker {
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
    this.mutex = new Mutex(this.redis, this.id, {
      lockTimeout: 30_000,
      acquireTimeout: 30_000,
      refreshInterval: 10_000,
      onLockLost: () => void requestRelease(),
    })
    await this.mutex.acquire(signal)
  }

  async unlock() {
    await this.mutex?.release()
    this.mutex = undefined
  }
}
