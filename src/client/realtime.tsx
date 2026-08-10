import type { Centrifuge, Subscription, SubscriptionOptions } from 'centrifuge'
import { createSameOriginRealtimeClient, requestRealtimeTicket, watchServerChannel } from 'ras-stack/realtime/client'
import { useConnectedRealtimeClient, useRealtimeSubscription as useSharedRealtimeSubscription } from 'ras-stack/realtime/react'
import { createContext, useCallback, useContext, useEffect } from 'react'

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

const channelSubscriptionOptions: SubscriptionOptions = { getToken: ({ channel }) => channelToken(channel) }

const tokenFromTicket = (value: unknown) => (value as { token: string }).token

export function RealtimeProvider({ children, workspaceId }: { children: React.ReactNode; workspaceId: string }) {
  return <RealtimeConnection key={workspaceId}>{children}</RealtimeConnection>
}

function RealtimeConnection({ children }: { children: React.ReactNode }) {
  const createClient = useCallback(() => createSameOriginRealtimeClient({ getToken: connectionToken }), [])
  const client = useConnectedRealtimeClient(createClient)
  return <RealtimeContext value={client}>{children}</RealtimeContext>
}

export function useRealtimeSubscription(channel: string, configure: (subscription: Subscription) => void | (() => void)) {
  const client = useContext(RealtimeContext)
  useSharedRealtimeSubscription({
    client,
    channel,
    options: channelSubscriptionOptions,
    configure,
  })
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
