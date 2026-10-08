import { afterEach, describe, expect, it, vi } from 'vitest'
import { startAutoArchiveSweep } from './autoArchive'
import type { WorkLocker } from './workLock'

function locker(available: boolean) {
  const unlock = vi.fn(async () => undefined)
  const workLocker: WorkLocker = {
    newLock: () => ({ lock: async () => undefined, tryLock: async () => available, unlock }),
  }
  return { workLocker, unlock }
}

describe('startAutoArchiveSweep', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sweeps on start in single-node mode', async () => {
    const sweep = vi.fn(async () => undefined)

    await startAutoArchiveSweep({ lockId: 'auto-archive:w', sweep, onError: vi.fn() }).stop()

    expect(sweep).toHaveBeenCalledOnce()
  })

  it('sweeps and releases the lease when this replica acquires it', async () => {
    const sweep = vi.fn(async () => undefined)
    const { workLocker, unlock } = locker(true)

    await startAutoArchiveSweep({ lockId: 'auto-archive:w', sweep, onError: vi.fn(), workLocker }).stop()

    expect([sweep.mock.calls.length, unlock.mock.calls.length]).toEqual([1, 1])
  })

  it('skips the round while another replica holds the lease', async () => {
    const sweep = vi.fn(async () => undefined)

    await startAutoArchiveSweep({ lockId: 'auto-archive:w', sweep, onError: vi.fn(), workLocker: locker(false).workLocker }).stop()

    expect(sweep).not.toHaveBeenCalled()
  })

  it('skips an on-demand sweep while another replica holds the lease', async () => {
    const sweep = vi.fn(async () => undefined)
    const sweeper = startAutoArchiveSweep({ lockId: 'auto-archive:w', sweep, onError: vi.fn(), workLocker: locker(false).workLocker })

    await sweeper.sweepNow()
    await sweeper.stop()

    expect(sweep).not.toHaveBeenCalled()
  })

  it('runs an on-demand sweep after the one in flight instead of joining it', async () => {
    let finishFirst!: () => void
    const sweep = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(async () => await new Promise<void>((resolve) => (finishFirst = resolve)))
      .mockResolvedValue(undefined)
    const sweeper = startAutoArchiveSweep({ lockId: 'auto-archive:w', sweep, onError: vi.fn(), workLocker: locker(true).workLocker })
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'))

    const onDemand = sweeper.sweepNow()
    finishFirst()
    await onDemand
    await sweeper.stop()

    expect(sweep).toHaveBeenCalledTimes(2)
  })

  it('reports a failed sweep instead of throwing', async () => {
    const failure = new Error('database unavailable')
    const onError = vi.fn()

    await startAutoArchiveSweep({ lockId: 'auto-archive:w', sweep: async () => Promise.reject(failure), onError }).stop()

    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('sweeps again on every interval until stopped', async () => {
    vi.useFakeTimers()
    const sweep = vi.fn(async () => undefined)
    const sweeper = startAutoArchiveSweep({ lockId: 'auto-archive:w', sweep, onError: vi.fn(), intervalMs: 1_000 })

    await vi.advanceTimersByTimeAsync(2_000)
    await sweeper.stop()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(sweep).toHaveBeenCalledTimes(3)
  })
})
