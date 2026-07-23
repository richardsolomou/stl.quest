function configuredOrigins() {
  return [process.env.BETTER_AUTH_URL, ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',') ?? [])]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      try {
        return [new URL(value).origin]
      } catch {
        return []
      }
    })
}

export function forwardedOrigin(request: Request) {
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host')?.trim()
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (!host || (protocol !== 'http' && protocol !== 'https')) return undefined
  try {
    return new URL(`${protocol}://${host}`).origin
  } catch {
    return undefined
  }
}

export function validSameOriginRequest(request: Request, allowReferer = false) {
  const origin = request.headers.get('origin') || (allowReferer ? refererOrigin(request) : undefined)
  const site = request.headers.get('sec-fetch-site')
  if (!origin || (site && site !== 'same-origin')) return false
  return [new URL(request.url).origin, forwardedOrigin(request), ...configuredOrigins()].includes(origin)
}

function refererOrigin(request: Request) {
  const referer = request.headers.get('referer')
  if (!referer) return undefined
  try {
    return new URL(referer).origin
  } catch {
    return undefined
  }
}
