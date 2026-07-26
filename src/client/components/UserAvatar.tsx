import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export function UserAvatar({ name, image, size = 'default' }: { name: string; image?: string; size?: 'sm' | 'default' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

  return (
    <Avatar size={size} className="ph-no-capture" aria-hidden="true">
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback className="bg-primary/15 font-heading font-semibold text-primary">{initials || '?'}</AvatarFallback>
    </Avatar>
  )
}
