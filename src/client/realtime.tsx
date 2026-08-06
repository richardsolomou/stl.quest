import { Centrifuge, UnauthorizedError, type ServerPublicationContext, type ServerSubscribedContext, type Subscription } from 'centrifuge'
import { createContext, useContext, useEffect, useState } from 'react'

const RealtimeContext = createContext<Centrifuge | undefined>(undefined)

async function connectionToken() {
  const response = await fetch('/api/realtime/token')
  if (response.status === 401 || response.status === 403) throw new UnauthorizedError('unauthorized')
  if (!response.ok) throw new Error(`Realtime authentication failed with status ${response.status}`)
  return ((await response.json()) as { token: string }).token
}

export async function channelToken(channel: string) {
  const response = await fetch('/api/realtime/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel }),
  })
  if (response.status === 401 || response.status === 403 || response.status === 404) throw new UnauthorizedError('unauthorized')
  if (!response.ok) throw new Error(`Realtime authorization failed with status ${response.status}`)
  return ((await response.json()) as { token: string }).token
}

export function RealtimeProvider({ children, workspaceId }: { children: React.ReactNode; workspaceId: string }) {
  const [client, setClient] = useState<Centrifuge>()
  useEffect(() => {
    const next = new Centrifuge(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/connection/websocket`, {
      getToken: connectionToken,
    })
    setClient(next)
    next.connect()
    return () => {
      setClient(undefined)
      next.disconnect()
    }
  }, [workspaceId])
  return <RealtimeContext value={client}>{children}</RealtimeContext>
}

export function useRealtimeSubscription(channel: string, configure: (subscription: Subscription) => void) {
  const client = useContext(RealtimeContext)
  useEffect(() => {
    if (!client || !channel) return
    const subscription = client.newSubscription(channel, { getToken: ({ channel: requested }) => channelToken(requested) })
    configure(subscription)
    subscription.subscribe()
    return () => client.removeSubscription(subscription)
  }, [channel, client, configure])
}

export function useWorkspaceUpdates(workspaceId: string, refresh: () => void) {
  const client = useContext(RealtimeContext)
  useEffect(() => {
    if (!client || !workspaceId) return
    return watchWorkspaceUpdates(client, workspaceId, refresh)
  }, [client, refresh, workspaceId])
}

export function watchWorkspaceUpdates(client: Centrifuge, workspaceId: string, refresh: () => void) {
  const channel = `workspace:${workspaceId}`
  const publication = (context: ServerPublicationContext) => {
    if (context.channel === channel) refresh()
  }
  const subscribed = (context: ServerSubscribedContext) => {
    if (context.channel === channel && context.wasRecovering && !context.recovered) refresh()
  }
  client.on('publication', publication)
  client.on('subscribed', subscribed)
  return () => {
    client.off('publication', publication)
    client.off('subscribed', subscribed)
  }
}
