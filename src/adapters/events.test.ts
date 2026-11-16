import { describe, expect, it, vi } from 'vitest'
import { RealtimeEventBus } from './events'

describe('RealtimeEventBus', () => {
  it('publishes workspace events on the workspace channel', () => {
    const publish = vi.fn(() => true)
    new RealtimeEventBus(publish, 'workspace').publish('request.created')
    expect(publish).toHaveBeenCalledExactlyOnceWith('workspace:workspace', { event: 'request.created' })
  })

  it('only coordinates storage changes between replicas', () => {
    const replicas = { publish: vi.fn() }
    const bus = new RealtimeEventBus(() => true, 'workspace', replicas as never)

    bus.publish('request.created')
    bus.publish('storage.changed')

    expect(replicas.publish).toHaveBeenCalledExactlyOnceWith('workspace')
  })
})
