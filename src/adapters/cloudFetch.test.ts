import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudFetch, cloudRequestError, waitForCloudRetry } from './cloudFetch'

describe('cloudFetch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('aborts requests that exceed their deadline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (signal?.aborted) reject(signal.reason)
          else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }),
    )

    await expect(cloudFetch('https://example.com', {}, 5)).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})

describe('waitForCloudRetry', () => {
  afterEach(() => vi.useRealTimers())

  it('uses capped exponential backoff', async () => {
    vi.useFakeTimers()
    const waiting = waitForCloudRetry(10)
    await vi.advanceTimersByTimeAsync(3_999)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(waiting).resolves.toBeUndefined()
  })

  it('honors a longer provider delay', async () => {
    vi.useFakeTimers()
    const waiting = waitForCloudRetry(0, { minimumDelayMs: 5_000 })
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(waiting).resolves.toBeUndefined()
  })
})

describe('cloudRequestError', () => {
  it('preserves shared response context and provider details', async () => {
    const response = new Response('rate limited', { status: 429 })
    await expect(cloudRequestError('Cloud', response, (body) => ({ retryable: body === 'rate limited' }))).resolves.toMatchObject({
      message: 'Cloud request failed (429): rate limited',
      status: 429,
      body: 'rate limited',
      retryable: true,
      $metadata: { httpStatusCode: 429 },
    })
  })
})
