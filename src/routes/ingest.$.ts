import { createFileRoute } from '@tanstack/react-router'

// Reverse proxy for browser PostHog traffic so telemetry works first-party
// in every deployment. Unauthenticated by design: it runs before login and
// forwards nothing from the app (cookies are stripped).
const INGEST_HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com'
const ASSETS_HOST = INGEST_HOST.replace(/\/\/(us|eu)\.i\./, '//$1-assets.i.')

async function proxy(request: Request, splat: string | undefined) {
  const path = `/${splat ?? ''}`
  const host = path.startsWith('/static/') || path.startsWith('/array/') ? ASSETS_HOST : INGEST_HOST
  const upstream = await fetch(`${host}${path}${new URL(request.url).search}`, {
    method: request.method,
    headers: {
      'Content-Type': request.headers.get('content-type') ?? 'application/json',
      'User-Agent': request.headers.get('user-agent') ?? 'printhub',
    },
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
  })
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream' },
  })
}

export const Route = createFileRoute('/ingest/$')({
  server: {
    handlers: {
      GET: ({ request, params }) => proxy(request, params._splat),
      POST: ({ request, params }) => proxy(request, params._splat),
    },
  },
})
