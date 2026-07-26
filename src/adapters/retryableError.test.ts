import { describe, expect, it } from 'vitest'
import { isRetryableError } from './retryableError'

describe('isRetryableError', () => {
  it('retries AWS SDK errors by their $metadata status', () => {
    expect(isRetryableError(Object.assign(new Error('busy'), { $metadata: { httpStatusCode: 503 } }))).toBe(true)
    expect(isRetryableError(Object.assign(new Error('slow'), { name: 'TimeoutError' }))).toBe(true)
    expect(isRetryableError(Object.assign(new Error('forbidden'), { $metadata: { httpStatusCode: 403 } }))).toBe(false)
  })

  it('retries WebDAV errors by their `.status`', () => {
    expect(isRetryableError(Object.assign(new Error('Bad Gateway'), { status: 502 }))).toBe(true)
    expect(isRetryableError(Object.assign(new Error('Too Many Requests'), { status: 429 }))).toBe(true)
    expect(isRetryableError(Object.assign(new Error('Request Timeout'), { status: 408 }))).toBe(true)
  })

  it('does not retry non-transient WebDAV failures', () => {
    expect(isRetryableError(Object.assign(new Error('Not Found'), { status: 404 }))).toBe(false)
    expect(isRetryableError(Object.assign(new Error('Unauthorized'), { status: 401 }))).toBe(false)
    expect(isRetryableError(new Error('no status at all'))).toBe(false)
  })
})
