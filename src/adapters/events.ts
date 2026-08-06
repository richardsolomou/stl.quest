import type { AppEvent, EventBus } from '../core/types'
import { logger } from '../server/logger'
import type { ReplicaStorageEvents } from './replicaEvents'

export class RealtimePublisher {
  private pending = new Map<string, { dirty: boolean; event: AppEvent }>()

  constructor(
    private apiUrl: string,
    private apiKey: string,
    private timeoutMs = 5_000,
    private retryMs = 1_000,
  ) {}

  publish(workspaceId: string, event: AppEvent) {
    if (!this.apiUrl) return
    const pending = this.pending.get(workspaceId)
    if (pending) {
      pending.dirty = true
      pending.event = event
      return
    }
    const state = { dirty: true, event }
    this.pending.set(workspaceId, state)
    void this.flush(workspaceId, state)
  }

  private async flush(workspaceId: string, state: { dirty: boolean; event: AppEvent }) {
    try {
      while (state.dirty) {
        state.dirty = false
        await this.deliver(workspaceId, state.event)
      }
    } catch (error) {
      logger.warn({ err: error, event: 'realtime_publish_failed', workspace_id: workspaceId }, 'realtime publish failed')
    } finally {
      if (this.pending.get(workspaceId) === state) this.pending.delete(workspaceId)
    }
  }

  private async deliver(workspaceId: string, event: AppEvent): Promise<void> {
    for (;;) {
      try {
        await this.deliverOnce(workspaceId, event)
        return
      } catch (error) {
        if (!(error instanceof TransientPublishError)) throw error
        logger.warn({ err: error, event: 'realtime_publish_retry', workspace_id: workspaceId }, 'retrying realtime publish')
        await new Promise((resolve) => setTimeout(resolve, this.retryMs))
      }
    }
  }

  private async deliverOnce(workspaceId: string, event: AppEvent) {
    let response: Response
    try {
      response = await fetch(`${this.apiUrl}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey },
        body: JSON.stringify({ channel: `workspace:${workspaceId}`, data: { event } }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      if (error instanceof TypeError || isTimeout(error))
        throw new TransientPublishError('Realtime publish request failed', { cause: error })
      throw error
    }
    if (!response.ok) {
      if (response.status < 500 && response.status !== 429) throw new Error(`Realtime publish failed with status ${response.status}`)
      throw new TransientPublishError(`Realtime publish failed with status ${response.status}`)
    }
    const result = (await response.json()) as { error?: { code?: number; message?: string } }
    if (result.error) {
      const message = result.error.message ?? `code ${result.error.code ?? 'unknown'}`
      if (result.error.code !== 100) throw new Error(`Realtime publish failed: ${message}`)
      throw new TransientPublishError(`Realtime publish failed: ${message}`)
    }
  }
}

class TransientPublishError extends Error {}

function isTimeout(error: unknown) {
  return error instanceof DOMException && error.name === 'TimeoutError'
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
