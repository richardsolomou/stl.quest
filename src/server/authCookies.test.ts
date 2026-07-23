import { describe, expect, it } from 'vitest'
import { normalizeAuthHeaders, prepareAuthRequest, secureResponseCookies } from './authCookies'

describe('auth response cookies', () => {
  it('secures cookies when a reverse proxy forwards HTTPS', () => {
    const response = new Response(null, { headers: { 'set-cookie': 'better-auth.session_token=token; Path=/; HttpOnly; SameSite=Lax' } })
    const secured = secureResponseCookies(
      new Request('http://container:3000/api/auth/sign-in/email', { headers: { 'x-forwarded-proto': 'https' } }),
      response,
    )

    expect(secured.headers.getSetCookie()).toEqual(['__Secure-better-auth.session_token=token; Path=/; HttpOnly; SameSite=Lax; Secure'])
  })

  it('leaves cookies usable over direct HTTP', () => {
    const response = new Response(null, { headers: { 'set-cookie': 'better-auth.session_token=token; Path=/; HttpOnly; SameSite=Lax' } })
    const unchanged = secureResponseCookies(new Request('http://nas.local/api/auth/sign-in/email'), response)

    expect(unchanged.headers.getSetCookie()).toEqual(['better-auth.session_token=token; Path=/; HttpOnly; SameSite=Lax'])
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
