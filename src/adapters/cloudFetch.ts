const CLOUD_REQUEST_TIMEOUT_MS = 2 * 60 * 1_000

export function cloudFetch(input: string | URL | Request, init: RequestInit = {}, timeoutMs = CLOUD_REQUEST_TIMEOUT_MS) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  return fetch(input, { ...init, signal })
}

export function waitForCloudRetry(attempt: number, options: { delayMs?: number; minimumDelayMs?: number } = {}) {
  const exponentialDelayMs = Math.min(250 * 2 ** attempt, 4_000)
  const delayMs = options.delayMs || Math.max(options.minimumDelayMs ?? 0, exponentialDelayMs)
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

export function isHttpNotFound(error: unknown) {
  return (error as { status?: number }).status === 404
}

export async function cloudRequestError<Details extends object>(
  provider: string,
  response: Response,
  details: (body: string, response: Response) => Details,
) {
  const body = await response.text()
  return Object.assign(new Error(`${provider} request failed (${response.status}): ${body}`), {
    status: response.status,
    body,
    $metadata: { httpStatusCode: response.status },
    ...details(body, response),
  })
}
