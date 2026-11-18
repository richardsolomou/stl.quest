export function errorMessage<Fallback extends string | undefined>(error: unknown, fallback: Fallback): string | Fallback {
  if (!error || typeof error !== 'object') return fallback
  const { message } = error as { message?: unknown }
  return typeof message === 'string' && message.trim() ? message : fallback
}

// Server-function rejections reach the client as a bare `Error` carrying the server's message, already captured
// server-side; only client-side faults (a non-base error such as `TypeError`, or no message) are worth reporting here.
export function isReportableMutationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true
  const { name, message } = error as { name?: unknown; message?: unknown }
  const serverDelivered = name === 'Error' && typeof message === 'string' && message.trim().length > 0
  return !serverDelivered
}

export type StlLoadErrorReason = 'timeout' | 'webgl_unavailable' | 'invalid_mesh' | 'load_failed'

// three.js's wording when the browser refuses a WebGL context; the viewer's probe reuses it.
const WEBGL_CONTEXT_ERROR = 'error creating webgl context'

// How an STL model-load rejection should be handled, or null for expected teardown: a plain AbortError comes from
// disposal or navigation, while the stall watchdog aborts with a TimeoutError. `webgl_unavailable` and `invalid_mesh`
// are terminal because retrying the same client or bytes can never succeed.
export function stlLoadErrorReason(error: unknown): StlLoadErrorReason | null {
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined
  if (name === 'AbortError') return null
  if (name === 'TimeoutError') return 'timeout'
  if (name === 'InvalidMeshError') return 'invalid_mesh'
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined
  if (typeof message === 'string' && message.toLowerCase().includes(WEBGL_CONTEXT_ERROR)) return 'webgl_unavailable'
  return 'load_failed'
}
