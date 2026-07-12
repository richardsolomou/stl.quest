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

function forwardedOrigin(request: Request) {
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host')?.trim()
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (!host || (protocol !== 'http' && protocol !== 'https')) return undefined
  try {
    return new URL(`${protocol}://${host}`).origin
  } catch {
    return undefined
  }
}

export function validSameOriginRequest(request: Request) {
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  if (!origin || (site && site !== 'same-origin')) return false
  return [new URL(request.url).origin, forwardedOrigin(request), ...configuredOrigins()].includes(origin)
}
