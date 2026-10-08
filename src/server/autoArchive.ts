import { acquireWorkLease, type WorkLocker } from './workLock'

const AUTO_ARCHIVE_INTERVAL_MS = 60 * 60_000

type AutoArchiveSweepOptions = {
  lockId: string
  sweep: () => Promise<unknown>
  onError: (error: unknown) => void
  workLocker?: WorkLocker
  intervalMs?: number
}

/** Sweeps now and then hourly; with a distributed locker, a scheduled round is skipped while another replica holds the lease. */
export function startAutoArchiveSweep({
  lockId,
  sweep,
  onError,
  workLocker,
  intervalMs = AUTO_ARCHIVE_INTERVAL_MS,
}: AutoArchiveSweepOptions) {
  let running: Promise<void> | undefined
  let stopped = false
  const run = (waitForLease: boolean) => {
    if (stopped) return Promise.resolve()
    running ??= (async () => {
      const lease = workLocker ? await acquireWorkLease(workLocker, lockId, waitForLease) : undefined
      if (workLocker && !lease) return
      try {
        await sweep()
      } finally {
        await lease?.release()
      }
    })()
      .catch(onError)
      .finally(() => (running = undefined))
    return running
  }
  const timer = setInterval(() => void run(false), intervalMs)
  timer.unref()
  void run(false)
  return {
    /** Starts a fresh sweep after any in flight, so a just-saved setting is read; another replica's sweep may have read the old one, so wait for its lease. */
    sweepNow: async () => {
      await running
      // A sweep that starts after the one awaited above has also read the new setting, so joining it is enough.
      await run(true)
    },
    stop: async () => {
      stopped = true
      clearInterval(timer)
      await running
    },
  }
}
