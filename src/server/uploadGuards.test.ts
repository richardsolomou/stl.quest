import { afterEach, describe, expect, it, vi } from 'vitest'
import { UploadRequestLimiter, validSameOrigin } from './uploadGuards'

describe('upload guards', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('requires the browser request to come from the same origin', () => {
    expect(
      validSameOrigin(
        new Request('https://print.test/api/upload', { headers: { origin: 'https://print.test', 'sec-fetch-site': 'same-origin' } }),
      ),
    ).toBe(true)
    expect(
      validSameOrigin(
        new Request('https://print.test/api/upload', { headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' } }),
      ),
    ).toBe(false)
  })

  it('accepts uploads from the configured public origin behind a reverse proxy', () => {
    vi.stubEnv('BETTER_AUTH_TRUSTED_ORIGINS', 'https://printhub.ras.sh')
    expect(
      validSameOrigin(
        new Request('http://localhost:3000/api/upload', {
          headers: { origin: 'https://printhub.ras.sh', 'sec-fetch-site': 'same-origin' },
        }),
      ),
    ).toBe(true)
  })

  it('accepts uploads from the origin forwarded by a reverse proxy', () => {
    expect(
      validSameOrigin(
        new Request('http://localhost:3000/api/upload', {
          headers: {
            origin: 'https://printhub.ras.sh',
            'sec-fetch-site': 'same-origin',
            'x-forwarded-host': 'printhub.ras.sh',
            'x-forwarded-proto': 'https',
          },
        }),
      ),
    ).toBe(true)
  })

  it('rejects an origin that does not match forwarded proxy headers', () => {
    expect(
      validSameOrigin(
        new Request('http://localhost:3000/api/upload', {
          headers: {
            origin: 'https://evil.test',
            'sec-fetch-site': 'same-origin',
            'x-forwarded-host': 'printhub.ras.sh',
            'x-forwarded-proto': 'https',
          },
        }),
      ),
    ).toBe(false)
  })

  it('bounds concurrent upload requests globally and per identity', () => {
    const limiter = new UploadRequestLimiter(2, 1)
    const first = limiter.enter('owner-a')
    expect(first).toBeTypeOf('function')
    expect(limiter.enter('owner-a')).toBeUndefined()
    const second = limiter.enter('owner-b')
    expect(second).toBeTypeOf('function')
    expect(limiter.enter('owner-c')).toBeUndefined()
    first!()
    expect(limiter.enter('owner-c')).toBeTypeOf('function')
    second!()
  })
})
