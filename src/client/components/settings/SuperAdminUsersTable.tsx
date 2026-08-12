import { useState } from 'react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { Ellipsis, Eye, KeyRound, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Account, AccountRole, Identity } from '../../../core/types'
import { ProtectedEmail } from '../ProtectedEmail'
import { UserTableIdentity } from '../UserTableIdentity'

export const accountRoleOptions = [
  { value: 'requester', label: 'User' },
  { value: 'super_admin', label: 'Super admin' },
] as const

export type SuperAdminUserAction = 'details' | 'impersonate' | 'role' | 'password'

const columnHelper = createColumnHelper<Account>()

export function superAdminUserColumns({
  me,
  passwordEnabled,
  onAction,
}: {
  me?: Identity
  passwordEnabled: boolean
  onAction: (action: SuperAdminUserAction, user: Account) => void
}): ColumnDef<Account>[] {
  return [
    columnHelper.accessor('name', {
      header: 'Name',
      cell: ({ row }) => <UserTableIdentity name={row.original.name} email={row.original.email} image={row.original.image} />,
      enableHiding: false,
    }),
    columnHelper.accessor('email', { header: 'Email', cell: ({ getValue }) => <ProtectedEmail email={getValue()} /> }),
    columnHelper.accessor('role', { header: 'Role', cell: ServerRoleCell }),
    columnHelper.accessor('createdAt', { header: 'Created', cell: ({ getValue }) => <DateCell value={getValue()} /> }),
    columnHelper.accessor('updatedAt', { header: 'Updated', cell: ({ getValue }) => <DateCell value={getValue()} /> }),
    columnHelper.accessor('lastOnlineAt', {
      header: 'Last online',
      cell: ({ getValue }) => (getValue() ? <DateCell value={getValue()!} /> : <span className="text-muted-foreground">Never</span>),
      sortUndefined: 'last',
    }),
    columnHelper.accessor('workspaceCount', { header: 'Workspaces' }),
    columnHelper.display({
      id: 'actions',
      enableHiding: false,
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex justify-end">
          {row.original.id === me?.id ? (
            <span className="px-2 text-xs text-muted-foreground">You</span>
          ) : (
            <UserActions user={row.original} passwordEnabled={passwordEnabled} onAction={onAction} />
          )}
        </div>
      ),
    }),
  ]
}

function DateCell({ value }: { value: number }) {
  return <time dateTime={new Date(value).toISOString()}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value)}</time>
}

function UserActions({
  user,
  passwordEnabled,
  onAction,
}: {
  user: Account
  passwordEnabled: boolean
  onAction: (action: SuperAdminUserAction, user: Account) => void
}) {
  const [open, setOpen] = useState(false)
  const choose = (action: SuperAdminUserAction) => {
    setOpen(false)
    onAction(action, user)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" className="ph-no-capture" aria-label={`Actions for ${user.name}`} />}
      >
        <Ellipsis />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 gap-0.5 p-1">
        <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => choose('impersonate')}>
          <Eye />
          View as user
        </Button>
        <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => choose('role')}>
          <ShieldCheck />
          Change server role
        </Button>
        {passwordEnabled && (
          <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => choose('password')}>
            <KeyRound />
            Set password
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ServerRoleCell({ getValue }: { getValue: () => AccountRole }) {
  return <Badge variant="secondary">{getValue() === 'super_admin' ? 'Super admin' : 'User'}</Badge>
}
