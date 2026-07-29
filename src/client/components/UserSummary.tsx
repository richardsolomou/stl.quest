import { Badge } from '@/components/ui/badge'
import { ProtectedEmail } from './ProtectedEmail'
import { UserAvatar } from './UserAvatar'

export function UserSummary({ user, role }: { user: { name: string; email: string; image?: string }; role: string }) {
  return (
    <div className="ph-no-capture flex items-center gap-3 rounded-lg border p-3">
      <UserAvatar name={user.name} image={user.image} />
      <div className="min-w-0">
        <p className="font-medium">{user.name}</p>
        <ProtectedEmail email={user.email} className="block text-sm text-muted-foreground" />
      </div>
      <Badge variant="secondary" className="ml-auto">
        {role}
      </Badge>
    </div>
  )
}
