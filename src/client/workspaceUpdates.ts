import type { Centrifuge } from 'centrifuge'
import { useEffect } from 'react'
import type { AppEvent } from '../core/types'
import { watchServerChannel } from './realtime'
import { useRealtimeClient } from './useRealtime'

/** Refreshes on every event in the workspace's server-side channel, and leaves the workspace once it is deleted. */
export function useWorkspaceUpdates(workspaceId: string, refresh: () => void, leave: () => void) {
  const client = useRealtimeClient()
  useEffect(() => {
    if (!client || !workspaceId) return
    return watchWorkspaceUpdates(client, workspaceId, refresh, leave)
  }, [client, leave, refresh, workspaceId])
}

export function watchWorkspaceUpdates(client: Centrifuge, workspaceId: string, refresh: () => void, leave: () => void) {
  return watchServerChannel(client, `workspace:${workspaceId}`, {
    publication: (context) => {
      if ((context.data as { event?: AppEvent } | undefined)?.event === 'workspace.deleted') leave()
      else refresh()
    },
    unrecovered: refresh,
  })
}
