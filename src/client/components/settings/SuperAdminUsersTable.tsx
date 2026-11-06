import { useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Ellipsis, Eye, KeyRound, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { DataTableFeatures } from '@/components/ui/data-table'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatBytes } from '../../../core/format'
import type { Locale, Messages } from '../../../core/i18n'
import { storagePlans } from '../../../core/plans'
import type { Account, Identity } from '../../../core/types'
import { ProtectedEmail } from '../ProtectedEmail'
import { UserTableIdentity, userEmailColumnMeta } from '../UserTableIdentity'

export const accountRoleOptions = (t: Messages) =>
  (['requester', 'super_admin'] as const).map((value) => ({ value, label: t.superAdmin.roles[value] }))

export const accountPlanOptions = [
  { value: 'free', label: 'Free' },
  { value: 'supporter', label: 'Supporter' },
  { value: 'pro', label: 'Pro' },
] as const

export type SuperAdminUserAction = 'details' | 'impersonate' | 'role' | 'password' | 'delete'

const columnHelper = createColumnHelper<DataTableFeatures, Account>()

export function superAdminUserColumns({
  t,
  locale,
  me,
  hosted,
  passwordEnabled,
  onAction,
}: {
  t: Messages
  locale: Locale
  me?: Identity
  hosted: boolean
  passwordEnabled: boolean
  onAction: (action: SuperAdminUserAction, user: Account) => void
}) {
  const copy = t.superAdmin
  return columnHelper.columns([
    columnHelper.accessor('name', {
      header: copy.columns.name,
      cell: ({ row }) => <UserTableIdentity name={row.original.name} email={row.original.email} image={row.original.image} />,
      enableHiding: false,
    }),
    columnHelper.accessor('email', {
      header: copy.columns.email,
      cell: ({ getValue }) => <ProtectedEmail email={getValue()} className="block max-w-40" />,
      meta: userEmailColumnMeta,
    }),
    columnHelper.accessor('role', {
      header: copy.columns.role,
      cell: ({ getValue }) => <Badge variant="secondary">{copy.roles[getValue()]}</Badge>,
      meta: { className: '@max-sm:hidden' },
    }),
    columnHelper.accessor('createdAt', {
      header: copy.columns.created,
      cell: ({ getValue }) => <DateCell value={getValue()} locale={locale} />,
      meta: { className: '@max-3xl:hidden' },
    }),
    columnHelper.accessor('updatedAt', {
      header: copy.columns.updated,
      cell: ({ getValue }) => <DateCell value={getValue()} locale={locale} />,
      meta: { className: '@max-3xl:hidden' },
    }),
    columnHelper.accessor('lastOnlineAt', {
      header: copy.columns.lastOnline,
      cell: ({ getValue }) => {
        const value = getValue()
        return value ? <DateCell value={value} locale={locale} /> : <span className="text-muted-foreground">{copy.never}</span>
      },
      sortUndefined: 'last',
      meta: { className: '@max-xl:hidden' },
    }),
    columnHelper.accessor('workspaceCount', { header: copy.columns.workspaces, meta: { className: '@max-xl:hidden' } }),
    ...(hosted
      ? [
          columnHelper.accessor('plan', {
            header: copy.columns.plan,
            cell: ({ getValue }) => {
              const plan = getValue() ?? 'free'
              return <Badge variant="secondary">{t.settings.plan.names[plan]}</Badge>
            },
            meta: { className: '@max-xl:hidden' },
          }),
          columnHelper.accessor('managedStorageUsedBytes', {
            id: 'storage',
            header: copy.columns.includedStorage,
            cell: ({ row }) => {
              const account = row.original
              if (!account.managedStorageWorkspaceCount) return <span className="text-muted-foreground">{copy.notInUse}</span>
              const usedBytes = account.managedStorageUsedBytes ?? 0
              const quotaBytes = account.managedStorageQuotaBytes ?? storagePlans.free.quotaBytes
              const percentage = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0
              return (
                <div className="whitespace-nowrap">
                  <p>{formatBytes(usedBytes, locale)}</p>
                  <p className="text-xs text-muted-foreground">
                    {copy.users.storageUsage(percentage, formatBytes(quotaBytes, locale), account.managedStorageWorkspaceCount)}
                  </p>
                </div>
              )
            },
            meta: { className: '@max-3xl:hidden' },
          }),
        ]
      : []),
    columnHelper.display({
      id: 'actions',
      enableHiding: false,
      header: copy.columns.actions,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <UserActions t={t} user={row.original} isMe={row.original.id === me?.id} passwordEnabled={passwordEnabled} onAction={onAction} />
        </div>
      ),
    }),
  ])
}

function DateCell({ value, locale }: { value: number; locale: Locale }) {
  return <time dateTime={new Date(value).toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(value)}</time>
}

function UserActions({
  t,
  user,
  isMe,
  passwordEnabled,
  onAction,
}: {
  t: Messages
  user: Account
  isMe: boolean
  passwordEnabled: boolean
  onAction: (action: SuperAdminUserAction, user: Account) => void
}) {
  const copy = t.superAdmin.userActions
  const [open, setOpen] = useState(false)
  const choose = (action: SuperAdminUserAction) => {
    setOpen(false)
    onAction(action, user)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" variant="ghost" size="icon-sm" className="ph-no-capture" aria-label={t.superAdmin.actionsFor(user.name)} />
        }
      >
        <Ellipsis />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 gap-0.5 p-1">
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start"
          disabled={isMe}
          title={isMe ? copy.impersonateSelf : undefined}
          onClick={() => choose('impersonate')}
        >
          <Eye />
          {copy.impersonate}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start"
          disabled={isMe}
          title={isMe ? copy.changeRoleSelf : undefined}
          onClick={() => choose('role')}
        >
          <ShieldCheck />
          {copy.changeRole}
        </Button>
        {passwordEnabled && (
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            disabled={isMe}
            title={isMe ? copy.setPasswordSelf : undefined}
            onClick={() => choose('password')}
          >
            <KeyRound />
            {copy.setPassword}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start text-destructive hover:text-destructive"
          disabled={isMe}
          title={isMe ? copy.deleteSelf : undefined}
          onClick={() => choose('delete')}
        >
          <Trash2 />
          {copy.delete}
        </Button>
        {isMe && <p className="mt-1 border-t px-2 pt-2 pb-1 text-xs text-muted-foreground">{copy.manageSelf}</p>}
      </PopoverContent>
    </Popover>
  )
}
