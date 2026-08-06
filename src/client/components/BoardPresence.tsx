import type { ClientInfo, Subscription } from 'centrifuge'
import { useCallback, useState } from 'react'
import { AvatarGroup } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useRealtimeSubscription } from '../realtime'
import { boardViewers, type BoardViewer } from './boardPresence'
import { UserAvatar } from './UserAvatar'

export function BoardPresence({ workspaceSlug, visible }: { workspaceSlug: string; visible: boolean }) {
  const [viewers, setViewers] = useState<BoardViewer[]>([])
  const configure = useCallback((subscription: Subscription) => {
    const connections = new Map<string, ClientInfo>()
    const render = () => {
      setViewers(boardViewers(connections.values()))
    }
    subscription.on('subscribed', () => {
      void subscription.presence().then(({ clients }) => {
        connections.clear()
        for (const [id, info] of Object.entries(clients)) connections.set(id, info)
        render()
      })
    })
    subscription.on('join', ({ info }) => {
      connections.set(info.client, info)
      render()
    })
    subscription.on('leave', ({ info }) => {
      connections.delete(info.client)
      render()
    })
  }, [])
  useRealtimeSubscription(visible ? `board:${workspaceSlug}` : '', configure)

  if (!visible || viewers.length === 0) return null
  return (
    <AvatarGroup aria-label={`${viewers.length} ${viewers.length === 1 ? 'person' : 'people'} viewing this board`}>
      {viewers.map((viewer) => (
        <Tooltip key={viewer.id}>
          <TooltipTrigger render={<span className="ph-no-capture rounded-full" />}>
            <UserAvatar name={viewer.name} image={viewer.image} size="sm" />
          </TooltipTrigger>
          <TooltipContent className="ph-no-capture">{viewer.name}</TooltipContent>
        </Tooltip>
      ))}
    </AvatarGroup>
  )
}
