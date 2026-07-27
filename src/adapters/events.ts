import { EventEmitter } from 'node:events'
import type { AppEvent, EventBus } from '../core/types'
import Redis from 'ioredis'
import crypto from 'node:crypto'

export class LocalEventBus implements EventBus {
  private emitter = new EventEmitter()

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

  /** Signals long-lived subscribers (SSE streams) to end; they reconnect to the replacement bus. */
  onClose(listener: () => void) {
    this.emitter.once('close', listener)
    return () => this.emitter.off('close', listener)
  }

  close() {
    this.emitter.emit('close')
  }
}

export class RedisEventHub {
  private id = crypto.randomUUID()
  private subscriber: Redis
  private buses = new Map<string, Set<RedisEventBus>>()

  constructor(
    private publisher: Redis,
    private onError: (error: unknown) => void = () => undefined,
  ) {
    this.subscriber = publisher.duplicate()
    this.subscriber.on('message', (channel, message) => {
      try {
        const payload = JSON.parse(message) as { source: string; event: AppEvent }
        if (payload.source === this.id) return
        for (const bus of this.buses.get(channel) ?? []) bus.receive(payload.event)
      } catch (error) {
        this.onError(error)
      }
    })
    this.subscriber.on('error', this.onError)
  }

  bus(workspaceId: string) {
    const channel = `stlquest:events:${workspaceId}`
    const bus = new RedisEventBus(this, channel)
    const buses = this.buses.get(channel) ?? new Set()
    buses.add(bus)
    this.buses.set(channel, buses)
    if (buses.size === 1) void this.subscriber.subscribe(channel).catch(this.onError)
    return bus
  }

  publish(channel: string, event: AppEvent) {
    void this.publisher.publish(channel, JSON.stringify({ source: this.id, event })).catch(this.onError)
  }

  remove(channel: string, bus: RedisEventBus) {
    const buses = this.buses.get(channel)
    buses?.delete(bus)
    if (!buses?.size) {
      this.buses.delete(channel)
      void this.subscriber.unsubscribe(channel).catch(this.onError)
    }
  }

  async close() {
    await this.subscriber.quit()
  }
}

class RedisEventBus extends LocalEventBus {
  constructor(
    private hub: RedisEventHub,
    private channel: string,
  ) {
    super()
  }

  override publish(event: AppEvent) {
    super.publish(event)
    this.hub.publish(this.channel, event)
  }

  receive(event: AppEvent) {
    super.publish(event)
  }

  override close() {
    this.hub.remove(this.channel, this)
    super.close()
  }
}
