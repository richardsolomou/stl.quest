// Adapter-agnostic classification of transient errors worth retrying. Different
// backends surface the HTTP status differently: the AWS SDK puts it on
// `$metadata.httpStatusCode`, while WebDAV (and other plain HTTP clients) put it
// on `.status`. We treat 408, 429, and any 5xx as transient regardless of shape.
export function isRetryableError(error: unknown) {
  const candidate = error as {
    name?: string
    $retryable?: unknown
    status?: number
    $metadata?: { httpStatusCode?: number }
  }
  const status = candidate.$metadata?.httpStatusCode ?? candidate.status
  return (
    !!candidate.$retryable ||
    candidate.name === 'TimeoutError' ||
    candidate.name === 'NetworkingError' ||
    status === 408 ||
    status === 429 ||
    (status !== undefined && status >= 500)
  )
}

export function httpStatus(error: unknown) {
  const candidate = error as { status?: number; $metadata?: { httpStatusCode?: number } }
  return candidate.$metadata?.httpStatusCode ?? candidate.status
}

// Storage operations also fail transiently below HTTP: dropped sockets, DNS, and undici timeouts.
export function isRetryableStorageError(error: unknown) {
  const candidate = error as {
    code?: string
    retryable?: boolean
    status?: number
    $metadata?: { httpStatusCode?: number }
    cause?: { code?: string }
  }
  const status = httpStatus(error)
  if (status !== undefined) return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
  const code = candidate.code ?? candidate.cause?.code
  return (
    isRetryableError(error) ||
    candidate.retryable === true ||
    (error instanceof TypeError && (error.message === 'fetch failed' || error.message === 'terminated')) ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENETUNREACH' ||
    code === 'EHOSTUNREACH' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
  )
}
