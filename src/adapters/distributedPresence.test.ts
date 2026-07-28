import { describe, expect, it, vi } from 'vitest'
import { DistributedBoardPresence } from './distributedPresence'

function redisWith(expiredIds: string[] = []) {
  const exec = vi.fn(async () => undefined)
  const multi = vi.fn(() => ({
    zrangebyscore: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    hset: vi.fn().mockReturnThis(),
    zrem: vi.fn().mockReturnThis(),
    hdel: vi.fn().mockReturnThis(),
    exec,
  }))
  const subscriber = { on: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), quit: vi.fn() }
  return {
    redis: { duplicate: () => subscriber, on: vi.fn(), multi, publish: vi.fn(), eval: vi.fn(async () => expiredIds) },
    subscriber,
    multi,
  }
}

describe('distributed board presence', () => {
  it('does not broadcast unchanged lease refreshes', async () => {
    const setup = redisWith()
    const presence = new DistributedBoardPresence(setup.redis as never)

    await (presence as never as { refresh(...args: unknown[]): Promise<void> }).refresh('workspace', 'connection', {}, false)

    expect(setup.redis.publish).not.toHaveBeenCalled()
  })

  it('broadcasts when a refresh removes expired viewers', async () => {
    const setup = redisWith(['expired'])
    const presence = new DistributedBoardPresence(setup.redis as never)

    await (presence as never as { refresh(...args: unknown[]): Promise<void> }).refresh('workspace', 'connection', {}, false)

    expect(setup.redis.publish).toHaveBeenCalledOnce()
  })

  it('renews a connection atomically while removing expired viewers', async () => {
    const setup = redisWith(['connection'])
    const presence = new DistributedBoardPresence(setup.redis as never)

    await (presence as never as { refresh(...args: unknown[]): Promise<void> }).refresh('workspace', 'connection', { id: 'viewer' }, false)

    expect(setup.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('ZREM'"),
      2,
      'stlquest:presence:connections:workspace',
      'stlquest:presence:viewers:workspace',
      expect.any(Number),
      expect.any(Number),
      'connection',
      JSON.stringify({ id: 'viewer' }),
    )
  })

  it('removes a connection after an in-flight renewal finishes', async () => {
    vi.useFakeTimers()
    try {
      const setup = redisWith()
      let finishRenewal!: (value: string[]) => void
      setup.redis.eval = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockImplementationOnce(async () => await new Promise<string[]>((resolve) => (finishRenewal = resolve)))
      const presence = new DistributedBoardPresence(setup.redis as never)
      const leave = await presence.join('workspace', { id: 'viewer', name: 'Viewer', image: null } as never)

      await vi.advanceTimersByTimeAsync(15_000)
      leave()
      expect(setup.multi).not.toHaveBeenCalled()
      finishRenewal([])
      await vi.waitFor(() => expect(setup.multi).toHaveBeenCalledOnce())
      await presence.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('coalesces a burst of membership notifications', async () => {
    vi.useFakeTimers()
    try {
      const setup = redisWith()
      const presence = new DistributedBoardPresence(setup.redis as never)
      const broadcast = vi.spyOn(presence as unknown as { broadcast(): Promise<void> }, 'broadcast').mockResolvedValue(undefined)
      const message = setup.subscriber.on.mock.calls.find(([event]) => event === 'message')?.[1]

      message('stlquest:presence:events:workspace')
      message('stlquest:presence:events:workspace')
      await vi.advanceTimersByTimeAsync(250)

      expect(broadcast).toHaveBeenCalledOnce()
      await presence.close()
    } finally {
      vi.useRealTimers()
    }
  })
})
