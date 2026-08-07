import crypto from 'node:crypto'
import Redis from 'ioredis'

export class ReplicaStorageEvents {
  private id = crypto.randomUUID()
  private subscriber: Redis
  private listeners = new Set<(workspaceId: string) => void | Promise<void>>()
  private subscription: Promise<unknown>

  constructor(
    private publisher: Redis,
    private onError: (error: unknown) => void = () => undefined,
  ) {
    this.subscriber = publisher.duplicate()
    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      try {
        const payload = JSON.parse(message) as { source: string }
        if (payload.source === this.id) return
        const workspaceId = channel.slice('stlquest:replicas:'.length)
        for (const listener of this.listeners) void Promise.resolve(listener(workspaceId)).catch(this.onError)
      } catch (error) {
        this.onError(error)
      }
    })
    this.subscriber.on('error', this.onError)
    this.subscription = this.subscriber.psubscribe('stlquest:replicas:*').catch((error) => {
      this.onError(error)
      throw error
    })
  }

  publish(workspaceId: string) {
    void this.publisher.publish(`stlquest:replicas:${workspaceId}`, JSON.stringify({ source: this.id })).catch(this.onError)
  }

  onRemoteChange(listener: (workspaceId: string) => void | Promise<void>) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async ready() {
    await this.subscription
  }

  async close() {
    await this.subscriber.quit()
  }
}
