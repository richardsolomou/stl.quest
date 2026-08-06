import { EventEmitter } from 'node:events'
import type { AppEvent, EventBus } from '../core/types'
import { logger } from '../server/logger'
import type { ReplicaStorageEvents } from './replicaEvents'

export class LocalEventBus implements EventBus {
  protected emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(100)
  }

  publish(event: AppEvent) {
    this.emitter.emit('change', event)
  }

  subscribe(listener: (event: AppEvent) => void) {
    this.emitter.on('change', listener)
    return () => this.emitter.off('change', listener)
  }

  close() {
    this.emitter.removeAllListeners()
  }
}

export class CentrifugoPublisher {
  private pending = new Map<string, Promise<void>>()

  constructor(
    private apiUrl: string,
    private apiKey: string,
    private timeoutMs = 5_000,
    private retryMs = 1_000,
  ) {}

  publish(workspaceId: string, event: AppEvent) {
    if (!this.apiUrl) return
    const pending = (this.pending.get(workspaceId) ?? Promise.resolve())
      .then(() => this.deliver(workspaceId, event))
      .catch((error) => logger.warn({ err: error, event: 'realtime_publish_failed', workspace_id: workspaceId }, 'realtime publish failed'))
      .finally(() => {
        if (this.pending.get(workspaceId) === pending) this.pending.delete(workspaceId)
      })
    this.pending.set(workspaceId, pending)
  }

  private async deliver(workspaceId: string, event: AppEvent): Promise<void> {
    try {
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
          throw new TransientPublishError('Centrifugo publish request failed', { cause: error })
        throw error
      }
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) throw new Error(`Centrifugo publish failed with status ${response.status}`)
        throw new TransientPublishError(`Centrifugo publish failed with status ${response.status}`)
      }
      const result = (await response.json()) as { error?: { code?: number; message?: string } }
      if (result.error) {
        const message = result.error.message ?? `code ${result.error.code ?? 'unknown'}`
        if (result.error.code !== 100) throw new Error(`Centrifugo publish failed: ${message}`)
        throw new TransientPublishError(`Centrifugo publish failed: ${message}`)
      }
    } catch (error) {
      if (!(error instanceof TransientPublishError)) throw error
      logger.warn({ err: error, event: 'realtime_publish_retry', workspace_id: workspaceId }, 'retrying realtime publish')
      await new Promise((resolve) => setTimeout(resolve, this.retryMs))
      return this.deliver(workspaceId, event)
    }
  }
}

class TransientPublishError extends Error {}

function isTimeout(error: unknown) {
  return error instanceof DOMException && error.name === 'TimeoutError'
}

export class CentrifugoEventBus extends LocalEventBus {
  constructor(
    private publisher: CentrifugoPublisher,
    private workspaceId: string,
    private replicas?: ReplicaStorageEvents,
  ) {
    super()
  }

  override publish(event: AppEvent) {
    super.publish(event)
    this.publisher.publish(this.workspaceId, event)
    if (event === 'storage.changed') this.replicas?.publish(this.workspaceId)
  }
}
