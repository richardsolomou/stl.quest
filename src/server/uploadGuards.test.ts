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
    vi.stubEnv('BETTER_AUTH_TRUSTED_ORIGINS', 'https://stl.quest')
    expect(
      validSameOrigin(
        new Request('http://localhost:3000/api/upload', {
          headers: { origin: 'https://stl.quest', 'sec-fetch-site': 'same-origin' },
        }),
      ),
    ).toBe(true)
  })

  it('accepts uploads from the origin forwarded by a reverse proxy', () => {
    expect(
      validSameOrigin(
        new Request('http://localhost:3000/api/upload', {
          headers: {
            origin: 'https://stl.quest',
            'sec-fetch-site': 'same-origin',
            'x-forwarded-host': 'stl.quest',
            'x-forwarded-proto': 'https',
          },
        }),
      ),
    ).toBe(true)
  })

  it('accepts a preserved public host with a forwarded protocol', () => {
    expect(
      validSameOrigin(
        new Request('http://localhost:3000/api/upload', {
          headers: {
            host: 'stl.quest',
            origin: 'https://stl.quest',
            'sec-fetch-site': 'same-origin',
            'x-forwarded-proto': 'https',
          },
        }),
      ),
    ).toBe(true)
  })

  it('accepts same-origin TUS resume checks using the browser referer', () => {
    expect(
      validSameOrigin(
        new Request('http://localhost:3000/api/upload/upload-id', {
          method: 'HEAD',
          headers: {
            host: 'stl.quest',
            referer: 'https://stl.quest/',
            'sec-fetch-site': 'same-origin',
            'x-forwarded-proto': 'https',
          },
        }),
      ),
    ).toBe(true)
  })

  it('does not accept referer-only upload mutations', () => {
    expect(
      validSameOrigin(
        new Request('https://print.test/api/upload', {
          method: 'PATCH',
          headers: { referer: 'https://print.test/', 'sec-fetch-site': 'same-origin' },
        }),
      ),
    ).toBe(false)
  })

  it('rejects an origin that does not match forwarded proxy headers', () => {
    expect(
      validSameOrigin(
        new Request('http://localhost:3000/api/upload', {
          headers: {
            origin: 'https://evil.test',
            'sec-fetch-site': 'same-origin',
            'x-forwarded-host': 'stl.quest',
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
