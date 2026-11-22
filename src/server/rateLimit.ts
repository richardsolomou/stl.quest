/**
 * Counts requests per key in fixed windows aligned to the epoch. It keeps only the current window's keys, so memory is
 * bounded by one window's traffic, and it lives in memory, so each replica counts its own requests.
 */
export function fixedWindowLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  let window = -1
  let counts = new Map<string, number>()
  return (key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } => {
    const at = now()
    const current = Math.floor(at / windowMs)
    if (current !== window) {
      window = current
      counts = new Map()
    }
    const count = (counts.get(key) ?? 0) + 1
    counts.set(key, count)
    if (count <= limit) return { allowed: true }
    return { allowed: false, retryAfterSeconds: Math.ceil(((current + 1) * windowMs - at) / 1_000) }
  }
}
