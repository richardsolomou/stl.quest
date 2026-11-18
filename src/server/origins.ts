/** The configured public address, such as `https://example.com`, or undefined when unset or invalid. */
function configuredOrigin() {
  return parseOrigin(process.env.BETTER_AUTH_URL)
}

function parseOrigin(value: string | undefined) {
  if (!value?.trim()) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

// Self-hosted installs sit behind whatever proxy the operator runs, so the forwarded origin is accepted without opting in.
function forwardedOrigin(request: Request) {
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host')?.trim()
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  return host && (protocol === 'http' || protocol === 'https') ? parseOrigin(`${protocol}://${host}`) : undefined
}

function additionalOrigins() {
  return (process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',') ?? []).map(parseOrigin)
}

/** Every origin this request may legitimately come from: its own, the forwarded one, `BETTER_AUTH_URL`, and `BETTER_AUTH_TRUSTED_ORIGINS`. */
export function acceptedOrigins(request: Request) {
  return [new URL(request.url).origin, forwardedOrigin(request), configuredOrigin(), ...additionalOrigins()].filter(
    (origin): origin is string => Boolean(origin),
  )
}

/** Where users reach the application, for absolute links: `BETTER_AUTH_URL`, then the forwarded origin, then the request's own. */
export function publicOrigin(request: Request) {
  return configuredOrigin() ?? forwardedOrigin(request) ?? new URL(request.url).origin
}

/** The extra origins Better Auth's `trustedOrigins` callback should accept for this request. */
export function trustedOrigins(request?: Request) {
  return request ? acceptedOrigins(request).filter((origin) => origin !== new URL(request.url).origin) : []
}

/** `allowReferer` accepts the referring page's origin when a browser sends no `Origin`, as it does for a tus `HEAD`. */
export function isSameOriginRequest(request: Request, { allowReferer = false } = {}) {
  const origin = request.headers.get('origin') || (allowReferer ? parseOrigin(request.headers.get('referer') ?? undefined) : undefined)
  const site = request.headers.get('sec-fetch-site')
  return Boolean(origin && (!site || site === 'same-origin') && acceptedOrigins(request).includes(origin))
}

/** Throws a 403 unless a browser on one of this application's origins sent the request. */
export function requireSameOrigin(request: Request) {
  if (!isSameOriginRequest(request)) throw new Response('cross-origin mutation rejected', { status: 403 })
}
