import { useEffect, useState } from 'react'
import { AvatarGroup } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { BoardViewer } from '../../server/boardPresence'
import { UserAvatar } from './UserAvatar'

export function BoardPresence({ workspaceSlug, visible }: { workspaceSlug: string; visible: boolean }) {
  const [viewers, setViewers] = useState<BoardViewer[]>([])

  useEffect(() => {
    const events = new EventSource(`/api/board-presence?workspace=${encodeURIComponent(workspaceSlug)}`)
    if (visible) {
      events.addEventListener('presence', (event) => setViewers(JSON.parse(event.data) as BoardViewer[]))
    }
    return () => events.close()
  }, [visible, workspaceSlug])

  if (!visible || viewers.length === 0) return null
  return (
    <AvatarGroup aria-label={`${viewers.length} ${viewers.length === 1 ? 'person' : 'people'} viewing this board`}>
      {viewers.map((viewer) => (
        <Tooltip key={viewer.id}>
          <TooltipTrigger render={<span className="rounded-full" />}>
            <UserAvatar name={viewer.name} image={viewer.image} size="sm" />
          </TooltipTrigger>
          <TooltipContent>{viewer.name}</TooltipContent>
        </Tooltip>
      ))}
    </AvatarGroup>
  )
}
