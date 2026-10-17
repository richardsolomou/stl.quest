import { publicOrigin as sharedPublicOrigin, validSameOriginRequest as sharedValidSameOriginRequest } from 'ras-stack/auth'

export function originOptions() {
  return {
    configured: [process.env.BETTER_AUTH_URL, ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',') ?? [])],
    trustForwardedHeaders: true,
  }
}

export function publicOrigin(request: Request) {
  return sharedPublicOrigin(request, originOptions())
}

export function validSameOriginRequest(request: Request, allowReferer = false) {
  return sharedValidSameOriginRequest(request, { ...originOptions(), allowReferer })
}
