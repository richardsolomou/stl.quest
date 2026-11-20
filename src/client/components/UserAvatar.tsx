import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { requesterInk } from '../requester'

export function UserAvatar({ name, image, size = 'default' }: { name: string; image?: string; size?: 'sm' | 'default' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  // The person's own ink plate rather than the accent, so the avatar and the detail chip agree on who someone is.
  const ink = requesterInk(name)

  return (
    <Avatar size={size} className="ph-no-capture rounded-[4px] after:rounded-[4px]" aria-hidden="true">
      {image && <AvatarImage src={image} alt="" className="rounded-[4px]" />}
      <AvatarFallback className="rounded-[4px] font-heading font-extrabold tracking-[0.02em] text-white" style={{ backgroundColor: ink }}>
        {initials || '?'}
      </AvatarFallback>
    </Avatar>
  )
}
