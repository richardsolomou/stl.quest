import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { createColumnHelper } from '@tanstack/react-table'
import { Ellipsis, Eye, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import type { DataTableFeatures } from '@/components/ui/data-table'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import type { Messages } from '../../../core/i18n'
import type { Identity, MemberRequestVisibility, WorkspaceRole } from '../../../core/types'
import type { MemberRequestVisibilityChoice } from '../../../core/visibility'
import { removeWorkspaceMember, updateMemberRequestVisibility, updateWorkspaceMemberRole } from '../../../server/fns'
import { boardQuery, sessionQuery, usersQuery } from '../../queries'
import { invalidateQueries, retryQueries } from '../../queryState'
import { useWorkspaceSlug } from '../../workspace'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { QueryState } from '../QueryState'
import { ProtectedEmail } from '../ProtectedEmail'
import { UserTableIdentity, userEmailColumnMeta } from '../UserTableIdentity'
import { UserSummary } from '../UserSummary'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsTableSection } from './SettingsLayout'
import { InviteDialog, PendingInvites } from './WorkspaceInvites'
import { useI18n } from '../../i18n'

type MembersCopy = Messages['settings']['members']

const memberRoleOptions = (copy: MembersCopy) =>
  [
    { value: 'member', label: copy.roles.member },
    { value: 'admin', label: copy.roles.admin },
  ] as const

export function UsersPane({ me }: { me: Identity }) {
  const workspaceSlug = useWorkspaceSlug()
  const usersResult = useQuery(usersQuery(workspaceSlug))
  const sessionResult = useQuery(sessionQuery(workspaceSlug))
  const users = usersResult.data
  const session = sessionResult.data
  const smtpConfigured = session?.email.workspaceConfigured === true
  const [inviting, setInviting] = useState(false)
  const [dialog, setDialog] = useState<{ action: UserAction; user: WorkspaceMember } | null>(null)
  const { t, locale } = useI18n()
  const copy = t.settings.members
  if (!users || !session) {
    return (
      <SettingsPage>
        <SettingsHeader title={copy.title} description={copy.description} />
        <QueryState
          loading={usersResult.isPending || sessionResult.isPending}
          error={usersResult.error ?? sessionResult.error}
          loadingLabel={copy.loading}
          errorTitle={copy.loadError}
          onRetry={() => void retryQueries(usersResult.refetch, sessionResult.refetch)}
        />
      </SettingsPage>
    )
  }
  return (
    <SettingsPage>
      <SettingsHeader title={copy.title} description={copy.description} />
      <SettingsTableSection>
        <DataTable
          columns={userColumns({
            me,
            copy,
            locale,
            onAction: (action, user) => setDialog({ action, user }),
          })}
          data={users}
          search={{ label: copy.table.searchLabel, placeholder: copy.table.searchPlaceholder }}
          filters={[
            {
              columnId: 'workspaceAccess',
              label: copy.table.roleFilter,
              allOption: { value: 'all', label: copy.table.allRoles },
              options: memberRoleOptions(copy),
              className: 'w-36',
            },
          ]}
          initialSorting={[
            { id: 'workspaceAccess', desc: false },
            { id: 'name', desc: false },
          ]}
          emptyMessage={copy.table.empty}
          itemLabel={copy.table.itemLabel}
          alignLastColumnRight
        />
      </SettingsTableSection>
      {dialog?.action === 'role' && <ChangeRoleDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {dialog?.action === 'visibility' && <ChangeVisibilityDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {dialog?.action === 'remove' && <RemoveMemberDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {inviting && <InviteDialog smtpConfigured={smtpConfigured} onDone={() => setInviting(false)} />}
      <SettingsActions>
        <Button type="button" data-onboarding="invite" onClick={() => setInviting(true)}>
          {copy.invite}
        </Button>
      </SettingsActions>
      <PendingInvites />
    </SettingsPage>
  )
}

const columnHelper = createColumnHelper<DataTableFeatures, WorkspaceMember>()
type WorkspaceMember = Identity & {
  requestVisibility?: MemberRequestVisibility
  effectiveRequestVisibility: MemberRequestVisibility
  lastActiveAt?: number
}
type UserAction = 'role' | 'visibility' | 'remove'
type WorkspaceAccess = 'admin' | 'member'
const workspaceRoleLabel = (copy: MembersCopy, user: WorkspaceMember) => copy.roles[user.workspaceRole ?? 'member']

function userColumns({
  me,
  copy,
  locale,
  onAction,
}: {
  me: Identity
  copy: MembersCopy
  locale: string
  onAction: (action: UserAction, user: WorkspaceMember) => void
}) {
  return columnHelper.columns([
    columnHelper.accessor('name', {
      header: copy.table.name,
      cell: ({ row }) => <UserTableIdentity name={row.original.name} email={row.original.email} image={row.original.image} />,
    }),
    columnHelper.accessor('email', {
      header: copy.table.email,
      cell: ({ getValue }) => <ProtectedEmail email={getValue()} className="block max-w-40" />,
      meta: userEmailColumnMeta,
    }),
    columnHelper.accessor((user): WorkspaceAccess => (user.workspaceRole === 'member' ? 'member' : 'admin'), {
      id: 'workspaceAccess',
      header: copy.table.role,
      cell: ({ getValue }) => <Badge variant="secondary">{copy.roles[getValue()]}</Badge>,
      meta: { className: '@max-sm:hidden' },
    }),
    columnHelper.accessor((user) => user.effectiveRequestVisibility, {
      id: 'requestVisibility',
      header: copy.table.sees,
      cell: ({ row, getValue }) => (
        <span className="text-sm text-muted-foreground">
          {getValue() === 'own' ? copy.table.seesOwn : copy.table.seesAll}
          {row.original.requestVisibility && <span className="ml-1 text-xs">{copy.table.setForThem}</span>}
        </span>
      ),
      meta: { className: '@max-xl:hidden' },
    }),
    columnHelper.accessor('lastActiveAt', {
      header: copy.table.lastActive,
      cell: ({ getValue }) => {
        const value = getValue()
        return value ? (
          <time dateTime={new Date(value).toISOString()} className="whitespace-nowrap text-sm text-muted-foreground">
            {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(value)}
          </time>
        ) : (
          <span className="text-sm text-muted-foreground">{copy.table.unknown}</span>
        )
      },
      sortUndefined: 'last',
      meta: { className: '@max-xl:hidden' },
    }),
    columnHelper.display({
      id: 'actions',
      header: copy.table.actions,
      cell: ({ row }) =>
        row.original.id === me.id ? (
          <span className="text-xs text-muted-foreground">{copy.table.you}</span>
        ) : row.original.workspaceRole === 'owner' ? (
          <span className="text-xs text-muted-foreground">{copy.roles.owner}</span>
        ) : (
          <UserActions user={row.original} onAction={onAction} />
        ),
    }),
  ])
}

function UserActions({ user, onAction }: { user: WorkspaceMember; onAction: (action: UserAction, user: WorkspaceMember) => void }) {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()
  const copy = t.settings.members
  const choose = (action: UserAction) => {
    setOpen(false)
    onAction(action, user)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" variant="ghost" size="icon-sm" className="ph-no-capture" aria-label={copy.actions.label(user.name)} />
        }
      >
        <Ellipsis />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 gap-0.5 p-1">
        <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => choose('role')}>
          <ShieldCheck />
          {copy.actions.changeRole}
        </Button>
        {user.role !== 'admin' && (
          <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => choose('visibility')}>
            <Eye />
            {copy.actions.changeVisibility}
          </Button>
        )}
        <Button type="button" variant="ghost" className="w-full justify-start text-destructive" onClick={() => choose('remove')}>
          <Trash2 />
          {copy.actions.remove}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function ChangeRoleDialog({ user, onDone }: { user: WorkspaceMember; onDone: () => void }) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const [role, setRole] = useState<Exclude<WorkspaceRole, 'owner'>>(user.workspaceRole === 'admin' ? 'admin' : 'member')
  const callUpdateRole = useServerFn(updateWorkspaceMemberRole)
  const { t } = useI18n()
  const copy = t.settings.members
  const roleOptions = memberRoleOptions(copy)
  const mutation = useMutation({
    mutationFn: (nextRole: Exclude<WorkspaceRole, 'owner'>) => callUpdateRole({ data: { workspaceSlug, userId: user.id, role: nextRole } }),
    onSuccess: async () => {
      await invalidateQueries(queryClient, 'people', 'users')
      onDone()
    },
  })

  return (
    <DialogShell title={copy.role.title} onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} role={workspaceRoleLabel(copy, user)} />
      <Field>
        <FieldLabel htmlFor={`role-${user.id}`}>{copy.role.label}</FieldLabel>
        <Select items={roleOptions} value={role} onValueChange={(value) => setRole(value as Exclude<WorkspaceRole, 'owner'>)}>
          <SelectTrigger className="ph-no-capture w-full" id={`role-${user.id}`} aria-label={copy.role.selectLabel(user.name)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{copy.role.help}</FieldDescription>
      </Field>
      <DialogProblem title={copy.role.notSaved} hint={copy.role.notSavedHint} error={mutation.error?.message} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          {t.common.cancel}
        </Button>
        <Button type="button" disabled={role === user.workspaceRole || mutation.isPending} onClick={() => mutation.mutate(role)}>
          {mutation.isPending && <Spinner />}
          {mutation.isPending ? t.common.saving : copy.actions.changeRole}
        </Button>
      </div>
    </DialogShell>
  )
}

function ChangeVisibilityDialog({ user, onDone }: { user: WorkspaceMember; onDone: () => void }) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const board = useQuery(boardQuery(workspaceSlug))
  const [choice, setChoice] = useState<MemberRequestVisibilityChoice>(user.requestVisibility ?? 'default')
  const callUpdateVisibility = useServerFn(updateMemberRequestVisibility)
  const { t } = useI18n()
  const copy = t.settings.members
  const mutation = useMutation({
    mutationFn: (visibility: MemberRequestVisibilityChoice) =>
      callUpdateVisibility({ data: { workspaceSlug, userId: user.id, visibility } }),
    onSuccess: async () => {
      await invalidateQueries(queryClient, 'people', 'users', 'board-settings')
      onDone()
    },
  })
  const options = [
    {
      value: 'default',
      label: board.data ? (board.data.privateRequests ? copy.visibility.defaultOwn : copy.visibility.defaultAll) : copy.visibility.default,
    },
    { value: 'own', label: copy.visibility.own },
    { value: 'all', label: copy.visibility.all },
  ] as const

  return (
    <DialogShell title={copy.visibility.title} onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} role={workspaceRoleLabel(copy, user)} />
      <Field>
        <FieldLabel htmlFor={`visibility-${user.id}`}>{copy.visibility.label}</FieldLabel>
        <Select items={options} value={choice} onValueChange={(value) => setChoice(value as MemberRequestVisibilityChoice)}>
          <SelectTrigger className="ph-no-capture w-full" id={`visibility-${user.id}`} aria-label={copy.visibility.selectLabel(user.name)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{copy.visibility.help}</FieldDescription>
      </Field>
      <DialogProblem title={copy.visibility.notSaved} hint={copy.visibility.notSavedHint} error={mutation.error?.message} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          {t.common.cancel}
        </Button>
        <Button
          type="button"
          disabled={choice === (user.requestVisibility ?? 'default') || mutation.isPending}
          onClick={() => mutation.mutate(choice)}
        >
          {mutation.isPending && <Spinner />}
          {mutation.isPending ? t.common.saving : copy.actions.changeVisibility}
        </Button>
      </div>
    </DialogShell>
  )
}

function RemoveMemberDialog({ user, onDone }: { user: WorkspaceMember; onDone: () => void }) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const callRemove = useServerFn(removeWorkspaceMember)
  const { t } = useI18n()
  const copy = t.settings.members
  const mutation = useMutation({
    mutationFn: () => callRemove({ data: { workspaceSlug, userId: user.id } }),
    onSuccess: async () => {
      await invalidateQueries(queryClient, 'people', 'users')
      onDone()
    },
  })
  return (
    <DialogShell title={copy.actions.remove} onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} role={workspaceRoleLabel(copy, user)} />
      <p className="text-sm text-muted-foreground">{copy.remove.description}</p>
      <DialogProblem title={copy.remove.notRemoved} hint={copy.remove.notRemovedHint} error={mutation.error?.message} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          {t.common.cancel}
        </Button>
        <Button type="button" variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending && <Spinner />}
          {copy.actions.remove}
        </Button>
      </div>
    </DialogShell>
  )
}
