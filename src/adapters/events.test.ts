import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { LocalEventBus, RedisEventHub } from './events'

describe('LocalEventBus', () => {
  it('delivers published events to subscribers until they unsubscribe', () => {
    const bus = new LocalEventBus()
    const heard = vi.fn<(event: string) => void>()
    const unsubscribe = bus.subscribe(heard)
    bus.publish('request.created')
    unsubscribe()
    bus.publish('request.deleted')
    expect(heard).toHaveBeenCalledExactlyOnceWith('request.created')
  })

  it('notifies close listeners once so streams can end and reconnect', () => {
    const bus = new LocalEventBus()
    const closed = vi.fn<() => void>()
    bus.onClose(closed)
    bus.close()
    bus.close()
    expect(closed).toHaveBeenCalledOnce()
  })
})

class FakeRedis extends EventEmitter {
  duplicate() {
    return this
  }

  async subscribe() {
    return 1
  }

  async unsubscribe() {
    return 0
  }

  async publish() {
    throw new Error('Redis unavailable')
  }

  async quit() {
    return 'OK'
  }
}

describe('RedisEventHub', () => {
  it('reports malformed messages without throwing from the subscriber', () => {
    const redis = new FakeRedis()
    const failed = vi.fn()
    const hub = new RedisEventHub(redis as never, failed)
    hub.bus('workspace')

    redis.emit('message', 'stlquest:events:workspace', 'not-json')

    expect(failed).toHaveBeenCalledOnce()
  })

  it('reports failed publications without rejecting the caller', async () => {
    const failed = vi.fn()
    const hub = new RedisEventHub(new FakeRedis() as never, failed)

    hub.bus('workspace').publish('request.created')
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce())
  })
})
