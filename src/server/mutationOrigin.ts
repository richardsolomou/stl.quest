import { getRequest } from '@tanstack/react-start/server'

// Trusted-header mode is exempt: the proxy-secret check already proves the
// request came through the authenticating proxy, not a cross-site page.
export function requireMutationOrigin(provider: 'local' | 'trusted-header', request = getRequest()) {
  if (provider === 'trusted-header') return
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  if (origin !== new URL(request.url).origin || (site && site !== 'same-origin')) {
    throw new Response('cross-origin mutation rejected', { status: 403 })
  }
}
