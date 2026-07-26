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
