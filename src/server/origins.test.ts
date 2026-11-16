import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptedOrigins, isSameOriginRequest, publicOrigin, requireSameOrigin, trustedOrigins } from './origins'

beforeEach(() => {
  vi.stubEnv('BETTER_AUTH_URL', undefined)
  vi.stubEnv('BETTER_AUTH_TRUSTED_ORIGINS', undefined)
})
afterEach(() => vi.unstubAllEnvs())

const post = (headers: Record<string, string>, url = 'https://app.example/action') => new Request(url, { method: 'POST', headers })

describe('mutation origin guard', () => {
  it('accepts a same-origin request', () => {
    expect(() => requireSameOrigin(post({ origin: 'https://app.example', 'sec-fetch-site': 'same-origin' }))).not.toThrow()
  })

  it('rejects a cross-origin request', () => {
    expect(() => requireSameOrigin(post({ origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' }))).toThrow(
      expect.objectContaining({ status: 403 }),
    )
  })

  it('rejects a request without an origin', () => {
    expect(() => requireSameOrigin(post({}))).toThrow(expect.objectContaining({ status: 403 }))
  })

  it('rejects a same-site sibling', () => {
    expect(isSameOriginRequest(post({ origin: 'https://sibling.example', 'sec-fetch-site': 'same-site' }))).toBe(false)
  })

  it('rejects a cross-site request even from the configured origin', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://app.example')
    expect(isSameOriginRequest(post({ origin: 'https://app.example', 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })

  it('accepts the configured public origin behind a proxy', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://app.example')
    expect(
      isSameOriginRequest(post({ origin: 'https://app.example', 'sec-fetch-site': 'same-origin' }, 'http://container:3000/action')),
    ).toBe(true)
  })

  it('accepts an additional trusted origin', () => {
    vi.stubEnv('BETTER_AUTH_TRUSTED_ORIGINS', 'https://alternate.example,https://other.example')
    expect(isSameOriginRequest(post({ origin: 'https://other.example' }, 'http://container:3000/action'))).toBe(true)
  })

  it('accepts the origin a proxy forwards', () => {
    const request = post(
      { origin: 'https://app.example', 'x-forwarded-host': 'app.example', 'x-forwarded-proto': 'https' },
      'http://container:3000/action',
    )
    expect(isSameOriginRequest(request)).toBe(true)
  })

  it('accepts a preserved public host with a forwarded protocol', () => {
    const request = post(
      { host: 'app.example', origin: 'https://app.example', 'x-forwarded-proto': 'https' },
      'http://localhost:3000/action',
    )
    expect(isSameOriginRequest(request)).toBe(true)
  })

  it('ignores a forwarded host without a valid protocol', () => {
    const malformed = post(
      { origin: 'https://app.example', 'x-forwarded-host': 'app.example', 'x-forwarded-proto': 'file' },
      'http://c:3000/',
    )
    const partial = post({ origin: 'https://app.example', 'x-forwarded-host': 'app.example' }, 'http://c:3000/')
    expect([isSameOriginRequest(malformed), isSameOriginRequest(partial)]).toEqual([false, false])
  })

  it('accepts the referring page only when asked to', () => {
    const head = new Request('https://app.example/api/upload/abc', { method: 'HEAD', headers: { referer: 'https://app.example/board' } })
    expect([isSameOriginRequest(head), isSameOriginRequest(head, { allowReferer: true })]).toEqual([false, true])
  })
})

describe('accepted origins', () => {
  it('normalizes BETTER_AUTH_URL and ignores an invalid one', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://app.example/path')
    expect(acceptedOrigins(new Request('http://container:3000/'))).toEqual(['http://container:3000', 'https://app.example'])
    vi.stubEnv('BETTER_AUTH_URL', 'not a URL')
    expect(acceptedOrigins(new Request('http://container:3000/'))).toEqual(['http://container:3000'])
  })

  it('gives Better Auth only the origins beyond the request itself', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://admin.example')
    const request = new Request('http://container:3000/', { headers: { 'x-forwarded-host': 'app.example', 'x-forwarded-proto': 'https' } })
    expect(trustedOrigins(request)).toEqual(['https://app.example', 'https://admin.example'])
  })
})

describe('public origin', () => {
  const proxied = new Request('http://container:3000/page', {
    headers: { 'x-forwarded-host': 'app.example', 'x-forwarded-proto': 'https' },
  })

  it('prefers BETTER_AUTH_URL', () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://canonical.example/path')
    expect(publicOrigin(proxied)).toBe('https://canonical.example')
  })

  it('uses the forwarded origin without BETTER_AUTH_URL', () => {
    expect(publicOrigin(proxied)).toBe('https://app.example')
  })

  it('falls back to the request origin', () => {
    expect(publicOrigin(new Request('http://container:3000/page'))).toBe('http://container:3000')
  })
})
