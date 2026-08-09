import type { Centrifuge, Subscription } from 'centrifuge'
import {
  connectRealtimeClient,
  createSameOriginRealtimeClient,
  openRealtimeSubscription,
  requestRealtimeTicket,
  watchServerChannel,
} from 'ras-stack/realtime/client'
import { createContext, useContext, useEffect, useState } from 'react'

const RealtimeContext = createContext<Centrifuge | undefined>(undefined)

async function connectionToken() {
  return requestRealtimeTicket('/api/realtime/token', { parse: tokenFromTicket })
}

export async function channelToken(channel: string) {
  return requestRealtimeTicket('/api/realtime/token', {
    unauthorizedStatuses: [401, 403, 404],
    init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }) },
    parse: tokenFromTicket,
    errorMessage: (status) => `Realtime authorization failed with status ${status}`,
  })
}

const tokenFromTicket = (value: unknown) => (value as { token: string }).token

export function RealtimeProvider({ children, workspaceId }: { children: React.ReactNode; workspaceId: string }) {
  const [client, setClient] = useState<Centrifuge>()
  useEffect(() => {
    const next = createSameOriginRealtimeClient({ getToken: connectionToken })
    setClient(next)
    const disconnect = connectRealtimeClient(next)
    return () => {
      setClient(undefined)
      disconnect()
    }
  }, [workspaceId])
  return <RealtimeContext value={client}>{children}</RealtimeContext>
}

export function useRealtimeSubscription(channel: string, configure: (subscription: Subscription) => void | (() => void)) {
  const client = useContext(RealtimeContext)
  useEffect(() => {
    if (!client || !channel) return
    return openRealtimeSubscription(client, channel, { getToken: ({ channel: requested }) => channelToken(requested) }, configure).close
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
  return watchServerChannel(client, channel, { publication: refresh, unrecovered: refresh })
}
