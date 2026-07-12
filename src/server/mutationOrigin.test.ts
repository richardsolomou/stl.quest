import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireMutationOrigin } from './mutationOrigin'

describe('cookie-auth mutation origin guard', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('accepts same-origin mutations', () => {
    expect(() =>
      requireMutationOrigin(
        new Request('https://print.test/_server', {
          headers: { origin: 'https://print.test', 'sec-fetch-site': 'same-origin' },
        }),
      ),
    ).not.toThrow()
  })

  it('accepts the configured public origin behind a reverse proxy', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://printhub.ras.sh')
    expect(() =>
      requireMutationOrigin(
        new Request('http://localhost:3000/_server', {
          headers: { origin: 'https://printhub.ras.sh', 'sec-fetch-site': 'same-origin' },
        }),
      ),
    ).not.toThrow()
  })

  it('accepts the origin forwarded by a reverse proxy', () => {
    expect(() =>
      requireMutationOrigin(
        new Request('http://localhost:3000/_server', {
          headers: {
            origin: 'https://printhub.ras.sh',
            'sec-fetch-site': 'same-origin',
            'x-forwarded-host': 'printhub.ras.sh',
            'x-forwarded-proto': 'https',
          },
        }),
      ),
    ).not.toThrow()
  })

  it('accepts a preserved public host with a forwarded protocol', () => {
    expect(() =>
      requireMutationOrigin(
        new Request('http://localhost:3000/_server', {
          headers: {
            host: 'printhub.ras.sh',
            origin: 'https://printhub.ras.sh',
            'sec-fetch-site': 'same-origin',
            'x-forwarded-proto': 'https',
          },
        }),
      ),
    ).not.toThrow()
  })

  it('rejects same-site sibling and missing-origin mutations', () => {
    expect(() =>
      requireMutationOrigin(
        new Request('https://print.test/_server', {
          headers: { origin: 'https://sibling.test', 'sec-fetch-site': 'same-site' },
        }),
      ),
    ).toThrow(expect.objectContaining({ status: 403 }))
    expect(() => requireMutationOrigin(new Request('https://print.test/_server'))).toThrow(expect.objectContaining({ status: 403 }))
  })
})
