export function errorMessage<Fallback extends string | undefined>(error: unknown, fallback: Fallback): string | Fallback {
  if (!error || typeof error !== 'object') return fallback
  const { message } = error as { message?: unknown }
  return typeof message === 'string' && message.trim() ? message : fallback
}

export type StlLoadErrorReason = 'timeout' | 'load_failed'

// How an STL model-load rejection should be reported to error tracking, or null when it
// should be swallowed. A plain AbortError means the in-flight fetch was torn down — the
// viewer was disposed (modal closed / retry) or the browser aborted it on navigation or
// reload — which is expected teardown, not a failure. The stall watchdog aborts with a
// TimeoutError instead, so genuine stalls are still reported as a timeout.
export function stlLoadErrorReason(error: unknown): StlLoadErrorReason | null {
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined
  if (name === 'AbortError') return null
  if (name === 'TimeoutError') return 'timeout'
  return 'load_failed'
}
