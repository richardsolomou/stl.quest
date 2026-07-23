import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAuthHeaders, prepareAuthRequest, secureResponseCookies, writeAuthCookies } from './authCookies'

const { getRequestMock, setCookieMock } = vi.hoisted(() => ({
  getRequestMock: vi.fn(),
  setCookieMock: vi.fn(),
}))

vi.mock('@tanstack/react-start/server', () => ({ getRequest: getRequestMock, setCookie: setCookieMock }))

describe('auth response cookies', () => {
  beforeEach(() => vi.clearAllMocks())

  it('secures cookies when a reverse proxy forwards HTTPS', () => {
    const response = new Response(null, { headers: { 'set-cookie': 'better-auth.session_token=token; Path=/; HttpOnly; SameSite=Lax' } })
    const secured = secureResponseCookies(
      new Request('http://container:3000/api/auth/sign-in/email', { headers: { 'x-forwarded-proto': 'https' } }),
      response,
    )

    expect(secured.headers.getSetCookie()).toEqual([
      'better-auth.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure',
      '__Secure-better-auth.session_token=token; Path=/; HttpOnly; SameSite=Lax; Secure',
    ])
  })

  it('leaves cookies usable over direct HTTP', () => {
    const response = new Response(null, { headers: { 'set-cookie': 'better-auth.session_token=token; Path=/; HttpOnly; SameSite=Lax' } })
    const unchanged = secureResponseCookies(new Request('http://nas.local/api/auth/sign-in/email'), response)

    expect(unchanged.headers.getSetCookie()).toEqual(['better-auth.session_token=token; Path=/; HttpOnly; SameSite=Lax'])
  })

  it('secures auth cookies explicitly written by server functions and expires unprefixed copies', () => {
    getRequestMock.mockReturnValue(new Request('http://container:3000/_server', { headers: { origin: 'https://print.example.com' } }))
    writeAuthCookies(new Headers({ 'set-cookie': 'better-auth.session_token=token; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600' }))

    expect(setCookieMock.mock.calls).toEqual([
      ['better-auth.session_token', '', { httpOnly: true, maxAge: 0, path: '/', sameSite: 'lax', secure: true }],
      ['__Secure-better-auth.session_token', 'token', { httpOnly: true, maxAge: 3600, path: '/', sameSite: 'lax', secure: true }],
    ])
  })

  it('keeps explicitly written server-function auth cookies unprefixed over direct HTTP', () => {
    getRequestMock.mockReturnValue(new Request('http://nas.local/_server'))
    writeAuthCookies(new Headers({ 'set-cookie': 'better-auth.session_token=token; Path=/; HttpOnly; SameSite=Lax' }))

    expect(setCookieMock).toHaveBeenCalledWith('better-auth.session_token', 'token', {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: false,
    })
  })

  it('keeps only the final replacement for cookies set twice in one HTTPS response', () => {
    const headers = new Headers()
    headers.append('set-cookie', 'better-auth.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
    headers.append('set-cookie', 'better-auth.session_token=replacement; Path=/; HttpOnly; SameSite=Lax')

    const secured = secureResponseCookies(
      new Request('https://print.example.com/api/auth/admin/impersonate-user'),
      new Response(null, { headers }),
    )

    expect(secured.headers.getSetCookie()).toEqual([
      'better-auth.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure',
      '__Secure-better-auth.session_token=replacement; Path=/; HttpOnly; SameSite=Lax; Secure',
    ])
  })

  it('normalizes secure auth cookies without consuming the request body', async () => {
    const request = prepareAuthRequest(
      new Request('http://container:3000/api/auth/get-session', {
        method: 'POST',
        body: '{}',
        headers: {
          cookie: '__Secure-better-auth.session_token=token; stlquest_invite=invite',
          origin: 'https://print.example.com',
        },
      }),
    )

    expect({ cookie: request.headers.get('cookie'), body: await request.text() }).toEqual({
      cookie: 'better-auth.session_token=token; stlquest_invite=invite',
      body: '{}',
    })
  })

  it('normalizes secure auth cookies for server functions', () => {
    const headers = normalizeAuthHeaders(new Headers({ cookie: '__Secure-better-auth.session_token=token; stlquest_invite=invite' }))

    expect(headers.get('cookie')).toBe('better-auth.session_token=token; stlquest_invite=invite')
  })

  it('prefers secure auth cookies over stale unprefixed copies', () => {
    const headers = normalizeAuthHeaders(
      new Headers({
        cookie:
          '__Secure-better-auth.session_token=impersonated; better-auth.session_token=admin; better-auth.admin_session=stale; __Secure-better-auth.admin_session=current',
      }),
    )

    expect(headers.get('cookie')).toBe('better-auth.session_token=impersonated; better-auth.admin_session=current')
  })

  it('normalizes server function headers after the request body was consumed', async () => {
    const request = new Request('http://container:3000/_server', {
      method: 'POST',
      body: '{}',
      headers: { cookie: '__Secure-better-auth.session_token=token' },
    })
    await request.text()

    expect(normalizeAuthHeaders(request.headers).get('cookie')).toBe('better-auth.session_token=token')
  })

  it('clones framework requests through their own implementation', async () => {
    const cloned = new Request('http://container:3000/api/auth/two-factor/verify-totp', {
      method: 'POST',
      body: '{}',
      headers: {
        cookie: '__Secure-better-auth.session_token=token',
        origin: 'https://print.example.com',
      },
    })
    const frameworkRequest = {
      url: cloned.url,
      headers: cloned.headers,
      clone: () => cloned,
    } as Request

    const prepared = prepareAuthRequest(frameworkRequest)

    expect(prepared).toBe(cloned)
    expect({ cookie: prepared.headers.get('cookie'), body: await prepared.text() }).toEqual({
      cookie: 'better-auth.session_token=token',
      body: '{}',
    })
  })

  it('prefers the browser origin over a conflicting forwarded protocol', () => {
    const response = new Response(null, { headers: { 'set-cookie': 'better-auth.session_token=token; Path=/' } })
    const secured = secureResponseCookies(
      new Request('http://container:3000/api/auth/sign-in/email', {
        headers: { origin: 'https://print.example.com', 'x-forwarded-proto': 'http' },
      }),
      response,
    )

    expect(secured.headers.getSetCookie()[0]).toContain('Secure')
  })
})
