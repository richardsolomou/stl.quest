import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudFetch } from './cloudFetch'

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
