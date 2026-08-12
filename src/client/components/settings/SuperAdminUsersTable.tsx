import { useState } from 'react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { Ellipsis, Eye, KeyRound, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatBytes } from '../../../core/format'
import { storagePlans } from '../../../core/plans'
import type { Account, AccountRole, Identity } from '../../../core/types'
import { ProtectedEmail } from '../ProtectedEmail'
import { UserTableIdentity } from '../UserTableIdentity'

export const accountRoleOptions = [
  { value: 'requester', label: 'User' },
  { value: 'super_admin', label: 'Super admin' },
] as const

export const accountPlanOptions = [
  { value: 'free', label: 'Free' },
  { value: 'supporter', label: 'Supporter' },
  { value: 'pro', label: 'Pro' },
] as const

export type SuperAdminUserAction = 'details' | 'impersonate' | 'role' | 'password'

const columnHelper = createColumnHelper<Account>()

export function superAdminUserColumns({
  me,
  hosted,
  passwordEnabled,
  onAction,
}: {
  me?: Identity
  hosted: boolean
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
    ...(hosted
      ? [
          columnHelper.accessor('plan', {
            header: 'Plan',
            cell: ({ getValue }) => {
              const plan = getValue() ?? 'free'
              return <Badge variant="secondary">{storagePlans[plan].name}</Badge>
            },
          }),
          columnHelper.accessor('managedStorageUsedBytes', {
            id: 'storage',
            header: 'Included storage',
            cell: ({ row }) => {
              const account = row.original
              if (!account.managedStorageWorkspaceCount) return <span className="text-muted-foreground">Not in use</span>
              const usedBytes = account.managedStorageUsedBytes ?? 0
              const quotaBytes = account.managedStorageQuotaBytes ?? storagePlans.free.quotaBytes
              const percentage = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0
              return (
                <div className="whitespace-nowrap">
                  <p>{formatBytes(usedBytes)}</p>
                  <p className="text-xs text-muted-foreground">
                    {percentage}% of {formatBytes(quotaBytes)} · {account.managedStorageWorkspaceCount}{' '}
                    {account.managedStorageWorkspaceCount === 1 ? 'workspace' : 'workspaces'}
                  </p>
                </div>
              )
            },
          }),
        ]
      : []),
    columnHelper.display({
      id: 'actions',
      enableHiding: false,
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex justify-end">
          <UserActions user={row.original} isMe={row.original.id === me?.id} passwordEnabled={passwordEnabled} onAction={onAction} />
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
  isMe,
  passwordEnabled,
  onAction,
}: {
  user: Account
  isMe: boolean
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
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start"
          disabled={isMe}
          title={isMe ? 'You are already viewing STL Quest as this user.' : undefined}
          onClick={() => choose('impersonate')}
        >
          <Eye />
          View as user
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start"
          disabled={isMe}
          title={isMe ? 'You cannot change your own server role.' : undefined}
          onClick={() => choose('role')}
        >
          <ShieldCheck />
          Change server role
        </Button>
        {passwordEnabled && (
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            disabled={isMe}
            title={isMe ? 'Change your own password from Account settings.' : undefined}
            onClick={() => choose('password')}
          >
            <KeyRound />
            Set password
          </Button>
        )}
        {isMe && <p className="mt-1 border-t px-2 pt-2 pb-1 text-xs text-muted-foreground">Manage your account from Account settings.</p>}
      </PopoverContent>
    </Popover>
  )
}

function ServerRoleCell({ getValue }: { getValue: () => AccountRole }) {
  return <Badge variant="secondary">{getValue() === 'super_admin' ? 'Super admin' : 'User'}</Badge>
}
