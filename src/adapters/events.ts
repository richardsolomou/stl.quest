import { CentrifugoPublisher } from 'ras-stack/realtime'
import type { AppEvent, EventBus } from '../core/types'
import { logger } from '../server/logger'
import type { ReplicaStorageEvents } from './replicaEvents'

export class RealtimePublisher {
  private readonly publisher: CentrifugoPublisher

  constructor(apiUrl: string, apiKey: string, timeoutMs = 5_000, retryMs = 1_000) {
    this.publisher = new CentrifugoPublisher({
      apiUrl,
      apiKey,
      timeoutMs,
      retryMs,
      onError: (error, channel) => logger.warn({ err: error, event: 'realtime_publish_failed', channel }, 'realtime publish failed'),
      onRetry: (error, channel) => logger.warn({ err: error, event: 'realtime_publish_retry', channel }, 'retrying realtime publish'),
    })
  }

  publish(workspaceId: string, event: AppEvent) {
    return this.publisher.publish(`workspace:${workspaceId}`, { event })
  }

  close() {
    return this.publisher.close()
  }
}

export class RealtimeEventBus implements EventBus {
  constructor(
    private publisher: RealtimePublisher,
    private workspaceId: string,
    private replicas?: ReplicaStorageEvents,
  ) {}

  publish(event: AppEvent) {
    this.publisher.publish(this.workspaceId, event)
    if (event === 'storage.changed') this.replicas?.publish(this.workspaceId)
  }
}
