import {
  Centrifuge,
  UnauthorizedError,
  type ServerPublicationContext,
  type ServerSubscribedContext,
  type SubscriptionOptions,
} from 'centrifuge'

/**
 * Fetches a connection token, or a subscription token for `channel`. A 401 or 403 becomes Centrifuge's `UnauthorizedError`,
 * which stops the client retrying a refusal; any other failure is retried with backoff.
 */
export async function realtimeToken(channel?: string, request: typeof fetch = fetch) {
  const response = await request('/api/realtime/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(channel === undefined ? {} : { channel }),
  })
  if (response.status === 401 || response.status === 403) throw new UnauthorizedError(`realtime access refused (${response.status})`)
  if (!response.ok) throw new Error(`Realtime authentication failed with status ${response.status}`)
  return ((await response.json()) as { token: string }).token
}

/** A client for this page's own origin; it fetches and refreshes its connection token itself. Call `connect()` to start it. */
export function createRealtimeClient(location: Pick<Location, 'host' | 'protocol'> = window.location) {
  const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/connection/websocket`
  return new Centrifuge(url, { getToken: () => realtimeToken() })
}

/** Options for `newSubscription` on a channel the browser subscribes to itself, which needs a subscription token. */
export const channelSubscriptionOptions: SubscriptionOptions = { getToken: ({ channel }) => realtimeToken(channel) }

/**
 * Follows a server-side channel the connection token granted. `unrecovered` runs when a reconnect could not replay the
 * publications missed meanwhile, so the caller can refetch. Returns the cleanup.
 */
export function watchServerChannel(
  client: Centrifuge,
  channel: string,
  handlers: { publication?: (context: ServerPublicationContext) => void; unrecovered?: (context: ServerSubscribedContext) => void },
) {
  const publication = (context: ServerPublicationContext) => {
    if (context.channel === channel) handlers.publication?.(context)
  }
  const subscribed = (context: ServerSubscribedContext) => {
    if (context.channel === channel && context.wasRecovering && !context.recovered) handlers.unrecovered?.(context)
  }
  client.on('publication', publication)
  client.on('subscribed', subscribed)
  return () => {
    client.off('publication', publication)
    client.off('subscribed', subscribed)
  }
}
