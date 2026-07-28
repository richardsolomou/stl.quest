import Redis from 'ioredis'
import { DistributedBoardPresence } from '../adapters/distributedPresence'
import { createDistributedUploadStorage, RedisLocker, type DistributedUploadStorage } from '../adapters/distributedUploads'
import { RedisEventHub } from '../adapters/events'
import type { DistributedConfig } from './distributed'

export type DistributedRuntime = DistributedUploadStorage & {
  workLocker: RedisLocker
  events: RedisEventHub
  presence: DistributedBoardPresence
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
  const events = new RedisEventHub(redis, onError)
  const presence = new DistributedBoardPresence(redis, onError)
  return {
    ...uploads,
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
