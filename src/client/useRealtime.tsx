import type { Centrifuge, Subscription } from 'centrifuge'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { channelSubscriptionOptions, createRealtimeClient } from './realtime'

const RealtimeContext = createContext<Centrifuge | undefined>(undefined)

/**
 * Opens one connection for everything below it. Remount it with a `key` when the signed-in viewer changes, because the
 * connection token, and the server-side channels it grants, belong to whoever was signed in when it connected.
 */
export function RealtimeProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const client = useConnectedRealtimeClient(createRealtimeClient, enabled)
  return <RealtimeContext value={client}>{children}</RealtimeContext>
}

/** The provider's client once connected; undefined during server rendering, while disabled, and outside a provider. */
export function useRealtimeClient() {
  return useContext(RealtimeContext)
}

/**
 * Creates and connects a client after mount, runs `configure` before connecting, and disconnects on unmount. `create` and
 * `configure` must keep their identity (module functions or `useCallback`), since a new one reconnects. A `configure` that
 * throws is reported as an uncaught error and leaves the client undefined, rather than unmounting the page around it.
 */
export function useConnectedRealtimeClient(
  create: () => Centrifuge,
  enabled = true,
  configure?: (client: Centrifuge) => void | (() => void),
) {
  const [client, setClient] = useState<Centrifuge>()
  useEffect(() => {
    if (!enabled) return undefined
    const next = create()
    let cleanup: void | (() => void)
    try {
      cleanup = configure?.(next)
    } catch (error) {
      next.disconnect()
      reportError(error)
      return undefined
    }
    // oxlint-disable-next-line react/set-state-in-effect -- The client is created by this effect, so state is how it reaches the caller.
    setClient(next)
    next.connect()
    return () => {
      try {
        cleanup?.()
      } finally {
        next.disconnect()
        setClient(undefined)
      }
    }
  }, [configure, create, enabled])
  return client
}

/**
 * Subscribes the provider's client to `channel` with a subscription token from `/api/realtime/token`, runs `configure` before
 * subscribing, and removes the subscription on unmount. `configure` must keep its identity; one that throws is reported and
 * leaves the subscription undefined.
 */
export function useRealtimeSubscription(channel: string | undefined, configure?: (subscription: Subscription) => void | (() => void)) {
  const client = useRealtimeClient()
  const [subscription, setSubscription] = useState<Subscription>()
  useEffect(() => {
    if (!client || !channel) return undefined
    const next = client.newSubscription(channel, channelSubscriptionOptions)
    let cleanup: void | (() => void)
    try {
      cleanup = configure?.(next)
      next.subscribe()
    } catch (error) {
      client.removeSubscription(next)
      reportError(error)
      return undefined
    }
    // oxlint-disable-next-line react/set-state-in-effect -- The subscription is created by this effect, so state is how it reaches the caller.
    setSubscription(next)
    return () => {
      try {
        cleanup?.()
      } finally {
        client.removeSubscription(next)
        setSubscription(undefined)
      }
    }
  }, [channel, client, configure])
  return subscription
}
