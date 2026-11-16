import type { AppEvent, EventBus } from '../core/types'
import type { ReplicaStorageEvents } from './replicaEvents'

/** Queues a realtime publication in the background; false when it was refused. */
export type RealtimePublish = (channel: string, data: unknown) => boolean

/** Publishes a workspace's events to its realtime channel, and storage changes to the other replicas. */
export class RealtimeEventBus implements EventBus {
  constructor(
    private publish_: RealtimePublish,
    private workspaceId: string,
    private replicas?: ReplicaStorageEvents,
  ) {}

  publish(event: AppEvent) {
    publishWorkspaceEvent(this.publish_, this.workspaceId, event)
    if (event === 'storage.changed') this.replicas?.publish(this.workspaceId)
  }
}

export function publishWorkspaceEvent(publish: RealtimePublish, workspaceId: string, event: AppEvent) {
  return publish(`workspace:${workspaceId}`, { event })
}
