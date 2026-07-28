import { describe, expect, it, vi } from 'vitest'
import { DistributedBoardPresence } from './distributedPresence'

function redisWith(expiredIds: string[] = []) {
  const exec = vi.fn(async () => [[undefined, expiredIds]])
  const multi = vi.fn(() => ({
    zrangebyscore: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    hset: vi.fn().mockReturnThis(),
    zrem: vi.fn().mockReturnThis(),
    hdel: vi.fn().mockReturnThis(),
    exec,
  }))
  const subscriber = { on: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), quit: vi.fn() }
  return { redis: { duplicate: () => subscriber, on: vi.fn(), multi, publish: vi.fn() }, publish: vi.fn() }
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
})
