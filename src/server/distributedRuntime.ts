import Redis from 'ioredis'
import { createDistributedUploadStorage, RedisLocker, type DistributedUploadStorage } from '../adapters/distributedUploads'
import { ReplicaStorageEvents } from '../adapters/replicaEvents'
import type { DistributedConfig } from './distributed'

export type DistributedRuntime = DistributedUploadStorage & {
  workLocker: RedisLocker
  events: ReplicaStorageEvents
  close(): Promise<void>
}

export async function createDistributedRuntime(
  config: DistributedConfig,
  onError: (error: unknown) => void = () => undefined,
): Promise<DistributedRuntime> {
  const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 })
  redis.on('error', onError)
  await redis.connect()
  const uploads = createDistributedUploadStorage(config.staging, redis)
  const events = new ReplicaStorageEvents(redis, onError)
  return {
    ...uploads,
    workLocker: new RedisLocker(redis, 'stlquest:work:'),
    events,
    close: async () => {
      await events.close()
      await redis.quit()
    },
  }
}
