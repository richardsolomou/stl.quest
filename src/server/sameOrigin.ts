import { forwardedOrigin, parseOrigin, validSameOriginRequest as sharedValidSameOriginRequest } from 'ras-stack/auth'

function configuredOrigins() {
  return [process.env.BETTER_AUTH_URL, ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',') ?? [])]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .map(parseOrigin)
    .filter((value): value is string => Boolean(value))
}

export { forwardedOrigin }

export function publicOrigin(request: Request) {
  const configured = configuredOrigins()[0]
  return configured ?? forwardedOrigin(request) ?? new URL(request.url).origin
}

export function validSameOriginRequest(request: Request, allowReferer = false) {
  return sharedValidSameOriginRequest(request, {
    allowReferer,
    configured: configuredOrigins(),
    trustForwardedHeaders: true,
  })
}
