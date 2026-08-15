const CLOUD_REQUEST_TIMEOUT_MS = 2 * 60 * 1_000

export async function cloudFetch(input: string | URL | Request, init: RequestInit = {}, timeoutMs = CLOUD_REQUEST_TIMEOUT_MS) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  try {
    return await fetch(input, { ...init, signal })
  } catch (error) {
    // `AbortSignal.timeout` creates its `DOMException` inside a Node timer, so the raw rejection has
    // no application frames and no request context. Wrap it in an error that names the request and
    // keeps the `DOMException` as `cause`. Keep the `TimeoutError` name so `isRetryableError` still
    // retries the request.
    if (timeoutSignal.aborted && error instanceof DOMException && error.name === 'TimeoutError') {
      throw Object.assign(new Error(`cloud request to ${describeCloudUrl(input)} timed out after ${timeoutMs}ms`, { cause: error }), {
        name: 'TimeoutError',
      })
    }
    throw error
  }
}

function describeCloudUrl(input: string | URL | Request) {
  try {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(href)
    // Drop the query string: it can carry access tokens, and the origin and path already name the request.
    return `${url.origin}${url.pathname}`
  } catch {
    return 'a cloud provider'
  }
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
