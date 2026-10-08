import { ProtectedEmail } from './ProtectedEmail'
import { UserAvatar } from './UserAvatar'

// The email moves under the name once the table is too narrow for its own column.
export const userEmailColumnMeta = { className: '@max-3xl:hidden' }

export function UserTableIdentity({ name, email, image }: { name: string; email: string; image?: string }) {
  return (
    <div className="ph-no-capture flex items-center gap-2.5">
      <UserAvatar name={name} image={image} size="sm" />
      <div className="min-w-0">
        <span className="block truncate" title={name}>
          {name}
        </span>
        <ProtectedEmail email={email} className="block text-xs text-muted-foreground @3xl:hidden" />
      </div>
    </div>
  )
}
