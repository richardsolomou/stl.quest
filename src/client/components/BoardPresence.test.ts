import { EventEmitter } from 'node:events'
import type { ClientInfo, Subscription } from 'centrifuge'
import { describe, expect, it, vi } from 'vitest'
import { boardViewers, watchBoardPresence } from './boardPresence'

describe('board presence', () => {
  it('uses channel-scoped viewer information', () => {
    expect(
      boardViewers([
        {
          client: 'client',
          user: 'user',
          connInfo: { id: 'wrong', name: 'Connection' },
          chanInfo: { id: 'right', name: 'Channel' },
        },
      ]),
    ).toEqual([{ id: 'right', name: 'Channel' }])
  })
})

describe('board presence subscription', () => {
  it('refreshes a snapshot when a join arrives while presence is loading', async () => {
    let resolveFirst!: (value: { clients: Record<string, ClientInfo> }) => void
    const first = new Promise<{ clients: Record<string, ClientInfo> }>((resolve) => {
      resolveFirst = resolve
    })
    const joined = viewer('joined')
    const emitter = new EventEmitter()
    const subscription = emitter as unknown as Subscription
    const presence = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce({ clients: { joined } })
    subscription.presence = presence
    const update = vi.fn()
    watchBoardPresence(subscription, update)

    emitter.emit('subscribed', {})
    emitter.emit('join', { info: joined })
    resolveFirst({ clients: {} })

    await vi.waitFor(() => expect(presence).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(update).toHaveBeenLastCalledWith([{ id: 'joined', name: 'joined' }]))
  })

  it('clears viewers when presence fails or the subscription closes', async () => {
    const emitter = new EventEmitter()
    const subscription = emitter as unknown as Subscription
    const presence = vi.fn().mockRejectedValue(new Error('unavailable'))
    subscription.presence = presence
    const update = vi.fn()
    const cleanup = watchBoardPresence(subscription, update)

    emitter.emit('join', { info: viewer('joined') })
    emitter.emit('subscribed', {})
    await vi.waitFor(() => expect(update).toHaveBeenLastCalledWith([]))
    emitter.emit('join', { info: viewer('stale') })
    cleanup()

    expect(update).toHaveBeenLastCalledWith([])
  })
})

function viewer(id: string): ClientInfo {
  return { client: id, user: id, chanInfo: { id, name: id } }
}
