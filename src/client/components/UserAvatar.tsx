import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { requesterInk } from '../requester'

export function UserAvatar({ name, image, size = 'default' }: { name: string; image?: string; size?: 'sm' | 'default' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  // The person's own ink rather than the accent: a board full of amber initials would outshout the
  // one amber that means "act here", and this keeps the avatar and the detail chip the same colour.
  const ink = requesterInk(name)

  return (
    <Avatar size={size} className="ph-no-capture" aria-hidden="true">
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback className="font-heading font-semibold" style={{ backgroundColor: `${ink}26`, color: ink }}>
        {initials || '?'}
      </AvatarFallback>
    </Avatar>
  )
}
