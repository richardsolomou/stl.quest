import { getRequest, setCookie } from '@tanstack/react-start/server'
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies'

const SECURE_PREFIX = '__Secure-'
const AUTH_PREFIX = 'better-auth.'

export function writeAuthCookies(headers: Headers) {
  const setCookies = headers.get('set-cookie')
  if (!setCookies) return
  const secure = requestProtocol(getRequest()) === 'https'
  for (const [name, attributes] of parseSetCookieHeader(setCookies)) {
    const options = toCookieOptions(attributes)
    if (secure && name.startsWith(AUTH_PREFIX)) {
      setCookie(name, '', { ...options, maxAge: 0, secure: true })
      setCookie(`${SECURE_PREFIX}${name}`, attributes.value, { ...options, secure: true })
    } else {
      setCookie(name, attributes.value, { ...options, secure })
    }
  }
}

export function prepareAuthRequest(request: Request) {
  if (requestProtocol(request) !== 'https') return request
  const headers = normalizeAuthHeaders(request.headers)
  if (headers === request.headers) return request
  // The server adapter hands us a Request-shaped wrapper (srvx) that is not a genuine
  // undici Request. Passing it to `new Request(request, …)` — or calling a method that
  // dereferences the wrapper's internal `#state` — throws "Cannot read private member
  // #state from an object whose class did not declare it" on Node 24. Rebuild from the
  // public accessors only, which every Request implementation supports.
  const body = request.body
  // `duplex: 'half'` is required when constructing a request from a stream body, but is not
  // yet in the DOM `RequestInit` type.
  const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers, body, signal: request.signal }
  if (body) init.duplex = 'half'
  return new Request(request.url, init)
}

export function normalizeAuthHeaders(headers: Headers) {
  const cookies = headers.get('cookie')
  if (!cookies?.includes(`${SECURE_PREFIX}${AUTH_PREFIX}`)) return headers
  const parts = cookies.split(';').map((cookie) => cookie.trim())
  const secureNames = new Set(
    parts
      .filter((cookie) => cookie.startsWith(`${SECURE_PREFIX}${AUTH_PREFIX}`))
      .map((cookie) => cookie.slice(SECURE_PREFIX.length).split('=', 1)[0]),
  )
  const normalized = new Headers(headers)
  normalized.set(
    'cookie',
    parts
      .filter((cookie) => {
        const name = cookie.split('=', 1)[0]
        return cookie.startsWith(SECURE_PREFIX) || !secureNames.has(name)
      })
      .map((cookie) => (cookie.startsWith(`${SECURE_PREFIX}${AUTH_PREFIX}`) ? cookie.slice(SECURE_PREFIX.length) : cookie))
      .join('; '),
  )
  return normalized
}

export function secureResponseCookies(request: Request, response: Response) {
  if (requestProtocol(request) !== 'https') return response
  const cookies = latestCookies(response.headers.getSetCookie())
  if (!cookies.length) return response
  const headers = new Headers(response.headers)
  headers.delete('set-cookie')
  for (const cookie of cookies) {
    const authCookie = cookie.startsWith(AUTH_PREFIX) ? `${SECURE_PREFIX}${cookie}` : cookie
    if (authCookie !== cookie) headers.append('set-cookie', expireUnprefixedCookie(cookie))
    headers.append('set-cookie', /;\s*secure(?:;|$)/i.test(authCookie) ? authCookie : `${authCookie}; Secure`)
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function latestCookies(cookies: string[]) {
  const latest = new Map<string, string>()
  for (const cookie of cookies) latest.set(cookie.split('=', 1)[0], cookie)
  return [...latest.values()]
}

function expireUnprefixedCookie(cookie: string) {
  const [name, ...attributes] = cookie.split(';')
  const suffix = attributes.filter((attribute) => !/^\s*(expires|max-age)=/i.test(attribute)).join(';')
  return `${name.split('=', 1)[0]}=;${suffix}; Max-Age=0; Secure`
}

function requestProtocol(request: Request) {
  const origin = request.headers.get('origin')
  const originProtocol = origin ? urlProtocol(origin) : undefined
  if (originProtocol) return originProtocol
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwarded === 'http' || forwarded === 'https') return forwarded
  return new URL(request.url).protocol.slice(0, -1)
}

function urlProtocol(value: string) {
  try {
    const protocol = new URL(value).protocol.slice(0, -1)
    return protocol === 'http' || protocol === 'https' ? protocol : undefined
  } catch {
    return undefined
  }
}
