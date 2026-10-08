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
    run,
    stop: async () => {
      stopped = true
      clearInterval(timer)
      await running
    },
  }
}
