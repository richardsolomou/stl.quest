const CLOUD_REQUEST_TIMEOUT_MS = 2 * 60 * 1_000

export function cloudFetch(input: string | URL | Request, init: RequestInit = {}, timeoutMs = CLOUD_REQUEST_TIMEOUT_MS) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  return fetch(input, { ...init, signal })
}
