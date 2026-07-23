const SECURE_PREFIX = '__Secure-'
const AUTH_PREFIX = 'better-auth.'

export function prepareAuthRequest(request: Request) {
  if (requestProtocol(request) !== 'https') return request
  const cookies = request.headers.get('cookie')
  if (!cookies?.includes(`${SECURE_PREFIX}${AUTH_PREFIX}`)) return request
  const prepared = request.clone()
  prepared.headers.set(
    'cookie',
    cookies
      .split(';')
      .map((cookie) => {
        const trimmed = cookie.trim()
        return trimmed.startsWith(`${SECURE_PREFIX}${AUTH_PREFIX}`) ? trimmed.slice(SECURE_PREFIX.length) : trimmed
      })
      .join('; '),
  )
  return prepared
}

export function secureResponseCookies(request: Request, response: Response) {
  if (requestProtocol(request) !== 'https') return response
  const cookies = response.headers.getSetCookie()
  if (!cookies.length) return response
  const headers = new Headers(response.headers)
  headers.delete('set-cookie')
  for (const cookie of cookies) {
    const authCookie = cookie.startsWith(AUTH_PREFIX) ? `${SECURE_PREFIX}${cookie}` : cookie
    headers.append('set-cookie', /;\s*secure(?:;|$)/i.test(authCookie) ? authCookie : `${authCookie}; Secure`)
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
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
