import { readLimitedBody } from './readLimitedBody'
import crypto from 'node:crypto'
import { logger } from './logger'
import { isSameOriginRequest } from './origins'
import { CentrifugoPublisher, type PublishOptions } from './realtimePublisher'

/**
 * Who a realtime connection belongs to. An empty `id` is an anonymous connection; `info` reaches presence and join events.
 * `workspace` is the workspace the connection follows, and whether the viewer may join its board's presence.
 */
export type RealtimeViewer = {
  id: string
  info?: Record<string, unknown>
  workspace?: { id: string; slug: string; boardPresence: boolean }
}

/** Decides who may connect: the viewer for this request, or undefined to refuse with 401. */
export type RealtimeViewerLookup = (request: Request) => Promise<RealtimeViewer | undefined> | RealtimeViewer | undefined

/** Which channels a viewer gets: server-side subscriptions in the connection token, and the ones the browser may subscribe to. */
export type RealtimePolicy = {
  serverChannels: (viewer: RealtimeViewer) => Promise<string[]> | string[]
  canSubscribe: (viewer: RealtimeViewer, channel: string) => Promise<boolean> | boolean
}

export type RealtimeTicketOptions = { viewer: RealtimeViewerLookup; policy: RealtimePolicy; secret: string }

// `scripts/realtime.ts dev` starts Centrifugo with this secret, so the two must match.
const developmentSecret = 'stlquest-development-realtime-secret'
const tokenLifetimeSeconds = 5 * 60
// Part of the shutdown budget in start-app's README; publications still queued after it are dropped.
const shutdownDeadlineMs = 1_000

export function realtimeSecret(environment: NodeJS.ProcessEnv = process.env) {
  const secret = environment.STLQUEST_REALTIME_SECRET?.trim()
  if (secret) return secret
  if (environment.NODE_ENV === 'production') throw new Error('STLQUEST_REALTIME_SECRET is required in production')
  return developmentSecret
}

/**
 * Centrifugo's HTTP API: on loopback beside the app in the container, and published on the same port in development. Tests
 * publish to nothing rather than to a Centrifugo that is not running.
 */
export function realtimeApi(environment: NodeJS.ProcessEnv = process.env) {
  return {
    url: environment.NODE_ENV === 'test' ? '' : environment.STLQUEST_REALTIME_API_URL?.trim() || 'http://127.0.0.1:8000/api',
    key: environment.STLQUEST_REALTIME_API_KEY?.trim() || realtimeSecret(environment),
  }
}

export function createRealtime(viewer: RealtimeViewerLookup, policy: RealtimePolicy) {
  const secret = realtimeSecret()
  const api = realtimeApi()
  const publisher = new CentrifugoPublisher({
    apiUrl: api.url,
    apiKey: api.key,
    onError: (error, channel) => logger.warn({ err: error, event: 'realtime_publish_failed', channel }, 'realtime publish failed'),
  })
  return {
    /** Sends `data` to everyone subscribed to `channel`, in the background; see `CentrifugoPublisher.publish`. */
    publish: (channel: string, data: unknown, options?: PublishOptions) => publisher.publish(channel, data, options),
    /** Answers `POST /api/realtime/token`. */
    ticket: (request: Request) => realtimeTicket(request, { viewer, policy, secret }),
    close: () => publisher.close(AbortSignal.timeout(shutdownDeadlineMs)),
  }
}

/**
 * Mints a connection token, or a subscription token when the body names a `channel`. Answers 401 when `viewer` refuses the
 * request and 403 for a channel the policy refuses; the browser client treats both as final instead of retrying.
 */
export async function realtimeTicket(request: Request, { viewer, policy, secret }: RealtimeTicketOptions, now = Date.now()) {
  if (!isSameOriginRequest(request)) return new Response('cross-origin mutation rejected', { status: 403 })
  const current = await viewer(request)
  if (!current) return Response.json({ error: 'unauthenticated' }, { status: 401 })
  const bytes = await readLimitedBody(request, 4096)
  if (!bytes) return new Response('ticket body too large', { status: 413 })
  let body: unknown
  try {
    body = bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : {}
  } catch {
    return new Response('invalid ticket body', { status: 400 })
  }
  const channel = body && typeof body === 'object' && 'channel' in body ? body.channel : undefined
  if (channel !== undefined && typeof channel !== 'string') return Response.json({ error: 'invalid channel' }, { status: 400 })
  const headers = { 'cache-control': 'no-store' }
  if (channel === undefined) {
    const channels = await policy.serverChannels(current)
    return Response.json({ token: signRealtimeToken(current, { channels }, secret, now) }, { headers })
  }
  if (!(await policy.canSubscribe(current, channel))) return Response.json({ error: 'channel not found' }, { status: 403 })
  return Response.json({ token: signRealtimeToken(current, { channel }, secret, now) }, { headers })
}

/** An HS256 JWT Centrifugo verifies with the shared secret; the subject and expiry always override `claims`. */
export function signRealtimeToken(viewer: RealtimeViewer, claims: Record<string, unknown>, secret: string, now = Date.now()) {
  const payload = {
    ...claims,
    ...(viewer.info ? { info: viewer.info } : {}),
    sub: viewer.id,
    exp: Math.floor(now / 1000) + tokenLifetimeSeconds,
  }
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`
  return `${unsigned}.${crypto.createHmac('sha256', secret).update(unsigned).digest('base64url')}`
}
