import { acquireWorkLease, type WorkLocker } from './workLock'

const AUTO_ARCHIVE_INTERVAL_MS = 60 * 60_000

type AutoArchiveSweepOptions = {
  lockId: string
  sweep: () => Promise<unknown>
  onError: (error: unknown) => void
  workLocker?: WorkLocker
  intervalMs?: number
}

/** Sweeps now and then hourly; with a distributed locker, a replica skips the round while another replica holds it. */
export function startAutoArchiveSweep({
  lockId,
  sweep,
  onError,
  workLocker,
  intervalMs = AUTO_ARCHIVE_INTERVAL_MS,
}: AutoArchiveSweepOptions) {
  let running: Promise<void> | undefined
  let stopped = false
  const run = () => {
    if (stopped) return Promise.resolve()
    running ??= (async () => {
      const lease = workLocker ? await acquireWorkLease(workLocker, lockId, false) : undefined
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
  const timer = setInterval(() => void run(), intervalMs)
  timer.unref()
  void run()
  return {
    /** Starts a fresh sweep after any in flight, so a just-saved setting is read; still skipped while another replica holds the lease. */
    sweepNow: async () => {
      await running
      // A sweep that starts after the one awaited above has also read the new setting, so joining it is enough.
      await run()
    },
    stop: async () => {
      stopped = true
      clearInterval(timer)
      await running
    },
  }
}
