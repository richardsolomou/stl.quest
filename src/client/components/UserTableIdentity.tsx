import { ProtectedEmail } from './ProtectedEmail'
import { UserAvatar } from './UserAvatar'

export function UserTableIdentity({ name, email, image }: { name: string; email: string; image?: string }) {
  return (
    <div className="ph-no-capture flex items-center gap-2.5">
      <UserAvatar name={name} image={image} size="sm" />
      <div className="min-w-0 max-w-28 sm:max-w-none">
        <span className="block truncate">{name}</span>
        <ProtectedEmail email={email} className="block text-xs text-muted-foreground sm:hidden" />
      </div>
    </div>
  )
}
