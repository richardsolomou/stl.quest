import type { Subscription } from 'centrifuge'
import { useCallback, useState } from 'react'
import { AvatarGroup } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useRealtimeSubscription } from '../realtime'
import { type BoardViewer, watchBoardPresence } from './boardPresenceState'
import { UserAvatar } from './UserAvatar'
import { useI18n } from '../i18n'

export function BoardPresence({ workspaceSlug, visible }: { workspaceSlug: string; visible: boolean }) {
  const { t } = useI18n()
  const [viewers, setViewers] = useState<BoardViewer[]>([])
  const configure = useCallback((subscription: Subscription) => watchBoardPresence(subscription, setViewers), [])
  useRealtimeSubscription(visible ? `board:${workspaceSlug}` : '', configure)

  if (!visible || viewers.length === 0) return null
  return (
    <AvatarGroup aria-label={t.board.presence.viewers(viewers.length)}>
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
