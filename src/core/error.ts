export function errorMessage<Fallback extends string | undefined>(error: unknown, fallback: Fallback): string | Fallback {
  if (!error || typeof error !== 'object') return fallback
  const { message } = error as { message?: unknown }
  return typeof message === 'string' && message.trim() ? message : fallback
}

// Whether a failed mutation is a genuine fault worth reporting to error tracking, or an expected
// rejection that should be swallowed. Every server-function rejection reaches the client as a bare
// `new Error(message)`: the framework's shallow error serialization discards the HTTP status, the
// error name, and the cause, so the 409-vs-500 distinction is simply not available here (a thrown
// `Response('…', { status: 409 })` and an unexpected server crash are indistinguishable once they
// cross the boundary). What survives is enough: a server-delivered rejection is a base `Error`
// carrying the server's own message — it is shown to the user inline and, if it was a real fault,
// already captured server-side with a full stack — so re-capturing it here only files a duplicate,
// lower-fidelity issue. A genuine client-side fault never reached the server: it surfaces as a
// non-base error (a `TypeError` from a dropped connection, an `AbortError`) or carries no message,
// and is the one worth reporting. Mirrors `stlLoadErrorReason`, which likewise swallows expected
// rejections while still surfacing real failures.
export function isReportableMutationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true
  const { name, message } = error as { name?: unknown; message?: unknown }
  const serverDelivered = name === 'Error' && typeof message === 'string' && message.trim().length > 0
  return !serverDelivered
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
