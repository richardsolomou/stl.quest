import { hostedDeployment } from './hosted'

/** A file only the hosted service publishes; a self-hosted install has no public site to describe. */
export function hostedFile(body: () => string, contentType: string) {
  if (!hostedDeployment()) return new Response('Not found', { status: 404 })
  return new Response(body(), { headers: { 'Cache-Control': 'public, max-age=3600', 'Content-Type': contentType } })
}
