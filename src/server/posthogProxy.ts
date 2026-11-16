import { ingestPath, type PostHogEnvironment } from '../contracts/posthog'

// A same-origin request carries the application's session cookie and any bearer token, and PostHog reads neither.
const credentialHeaders = ['cookie', 'authorization']
// `fetch` sets these itself: the upstream host, a body length, and only the encodings it can decode.
const transportHeaders = [
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'content-length',
  'accept-encoding',
]

/**
 * Forwards a request under `ingestPath` to PostHog: `static/` and `array/` paths to the assets host, everything else
 * to the ingestion host.
 */
export async function forwardToPostHog(request: Request, environment: Pick<PostHogEnvironment, 'host' | 'assetsHost'>) {
  const url = new URL(request.url)
  const path = url.pathname.slice(ingestPath.length) || '/'
  const upstream = /^\/(?:static|array)\//.test(path) ? environment.assetsHost : environment.host

  const dropped = new Set([...credentialHeaders, ...transportHeaders])
  const headers = new Headers([...request.headers].filter(([name]) => !dropped.has(name) && !name.startsWith('cf-')))
  // PostHog takes the first `X-Forwarded-For` address as the client's; Cloudflare names the client separately, and a
  // Worker's own fetch would otherwise make every event look like it came from Cloudflare.
  const client = request.headers.get('cf-connecting-ip')
  if (client) headers.set('x-forwarded-for', client)

  const response = await fetch(`${upstream}${path}${url.search}`, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer(),
    redirect: 'manual',
  })

  const responseHeaders = new Headers(response.headers)
  // `fetch` has decoded the body already, so its original encoding and length no longer describe it.
  for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']) responseHeaders.delete(name)
  // A third party must not set cookies on this application's origin.
  responseHeaders.delete('set-cookie')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders })
}
