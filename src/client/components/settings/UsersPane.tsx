import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { createColumnHelper } from '@tanstack/react-table'
import { Ellipsis, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import type { DataTableFeatures } from '@/components/ui/data-table'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import type { Identity, WorkspaceRole } from '../../../core/types'
import { removeWorkspaceMember, updateWorkspaceMemberRole } from '../../../server/fns'
import { sessionQuery, usersQuery } from '../../queries'
import { invalidateQueries, retryQueries } from '../../queryState'
import { useWorkspaceSlug } from '../../workspace'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { QueryState } from '../QueryState'
import { ProtectedEmail } from '../ProtectedEmail'
import { UserTableIdentity } from '../UserTableIdentity'
import { UserSummary } from '../UserSummary'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { InviteDialog, PendingInvites } from './WorkspaceInvites'

const MEMBER_ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const

export function UsersPane({ me }: { me: Identity }) {
  const workspaceSlug = useWorkspaceSlug()
  const usersResult = useQuery(usersQuery(workspaceSlug))
  const sessionResult = useQuery(sessionQuery(workspaceSlug))
  const users = usersResult.data
  const session = sessionResult.data
  const smtpConfigured = session?.email.configured === true
  const [inviting, setInviting] = useState(false)
  const [dialog, setDialog] = useState<{ action: UserAction; user: Identity } | null>(null)
  if (!users || !session) {
    return (
      <SettingsPage>
        <SettingsHeader title="Members" description="Manage workspace access, roles, and invitations." />
        <QueryState
          loading={usersResult.isPending || sessionResult.isPending}
          error={usersResult.error ?? sessionResult.error}
          loadingLabel="Loading members…"
          errorTitle="Could not load members"
          onRetry={() => void retryQueries(usersResult.refetch, sessionResult.refetch)}
        />
      </SettingsPage>
    )
  }
  return (
    <SettingsPage>
      <SettingsHeader title="Members" description="Manage workspace access, roles, and invitations." />
      <SettingsSection className="p-0 max-sm:[&_td]:px-1.5 max-sm:[&_td:nth-child(2)]:hidden max-sm:[&_th]:px-1.5 max-sm:[&_th:nth-child(2)]:hidden">
        <DataTable
          columns={userColumns({
            me,
            onAction: (action, user) => setDialog({ action, user }),
          })}
          data={users}
          search={{ label: 'Search members', placeholder: 'Search members…' }}
          filters={[
            {
              columnId: 'workspaceAccess',
              label: 'Filter members by role',
              allOption: { value: 'all', label: 'All roles' },
              options: MEMBER_ROLE_OPTIONS,
              className: 'w-36',
            },
          ]}
          initialSorting={[
            { id: 'workspaceAccess', desc: false },
            { id: 'name', desc: false },
          ]}
          emptyMessage="No members match these filters."
          itemLabel={{ singular: 'member', plural: 'members' }}
          alignLastColumnRight
        />
      </SettingsSection>
      {dialog?.action === 'role' && <ChangeRoleDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {dialog?.action === 'remove' && <RemoveMemberDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {inviting && <InviteDialog smtpConfigured={smtpConfigured} onDone={() => setInviting(false)} />}
      <SettingsActions>
        <Button type="button" data-onboarding="invite" onClick={() => setInviting(true)}>
          Invite user
        </Button>
      </SettingsActions>
      <PendingInvites />
    </SettingsPage>
  )
}

const columnHelper = createColumnHelper<DataTableFeatures, Identity>()
type UserAction = 'role' | 'remove'
type WorkspaceAccess = 'admin' | 'member'
const workspaceRoleLabel = (user: Identity) =>
  user.workspaceRole === 'owner' ? 'Owner' : user.workspaceRole === 'admin' ? 'Admin' : 'Member'

function userColumns({ me, onAction }: { me: Identity; onAction: (action: UserAction, user: Identity) => void }) {
  return columnHelper.columns([
    columnHelper.accessor('name', {
      header: 'Name',
      cell: ({ row }) => <UserTableIdentity name={row.original.name} email={row.original.email} image={row.original.image} />,
    }),
    columnHelper.accessor('email', { header: 'Email', cell: ({ getValue }) => <ProtectedEmail email={getValue()} /> }),
    columnHelper.accessor((user): WorkspaceAccess => (user.workspaceRole === 'member' ? 'member' : 'admin'), {
      id: 'workspaceAccess',
      header: 'Role',
      cell: ({ getValue }) => {
        const role = getValue()
        return <Badge variant="secondary">{role[0].toUpperCase() + role.slice(1)}</Badge>
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) =>
        row.original.id === me.id ? (
          <span className="text-xs text-muted-foreground">You</span>
        ) : (
          <UserActions user={row.original} onAction={onAction} />
        ),
    }),
  ])
}

function UserActions({ user, onAction }: { user: Identity; onAction: (action: UserAction, user: Identity) => void }) {
  const [open, setOpen] = useState(false)
  const choose = (action: UserAction) => {
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
      <PopoverContent align="end" className="w-48 gap-0.5 p-1">
        {user.workspaceRole !== 'owner' && (
          <>
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => choose('role')}>
              <ShieldCheck />
              Change role
            </Button>
            <Button type="button" variant="ghost" className="w-full justify-start text-destructive" onClick={() => choose('remove')}>
              <Trash2 />
              Remove member
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ChangeRoleDialog({ user, onDone }: { user: Identity; onDone: () => void }) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const [role, setRole] = useState<Exclude<WorkspaceRole, 'owner'>>(user.workspaceRole === 'admin' ? 'admin' : 'member')
  const callUpdateRole = useServerFn(updateWorkspaceMemberRole)
  const mutation = useMutation({
    mutationFn: (nextRole: Exclude<WorkspaceRole, 'owner'>) => callUpdateRole({ data: { workspaceSlug, userId: user.id, role: nextRole } }),
    onSuccess: async () => {
      await invalidateQueries(queryClient, 'people', 'users')
      onDone()
    },
  })

  return (
    <DialogShell title="Change role" onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} role={workspaceRoleLabel(user)} />
      <Field>
        <FieldLabel htmlFor={`role-${user.id}`}>Role</FieldLabel>
        <Select items={MEMBER_ROLE_OPTIONS} value={role} onValueChange={(value) => setRole(value as Exclude<WorkspaceRole, 'owner'>)}>
          <SelectTrigger className="ph-no-capture w-full" id={`role-${user.id}`} aria-label={`Role for ${user.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEMBER_ROLE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>Workspace admins can manage members, settings, and every print request in this workspace.</FieldDescription>
      </Field>
      <DialogProblem
        title="The role was not changed"
        hint="A workspace must keep at least one owner, and only an owner can hand that role over."
        error={mutation.error?.message}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="button" disabled={role === user.workspaceRole || mutation.isPending} onClick={() => mutation.mutate(role)}>
          {mutation.isPending && <Spinner />}
          {mutation.isPending ? 'Saving…' : 'Change role'}
        </Button>
      </div>
    </DialogShell>
  )
}

function RemoveMemberDialog({ user, onDone }: { user: Identity; onDone: () => void }) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const callRemove = useServerFn(removeWorkspaceMember)
  const mutation = useMutation({
    mutationFn: () => callRemove({ data: { workspaceSlug, userId: user.id } }),
    onSuccess: async () => {
      await invalidateQueries(queryClient, 'people', 'users')
      onDone()
    },
  })
  return (
    <DialogShell title="Remove member" onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} role={workspaceRoleLabel(user)} />
      <p className="text-sm text-muted-foreground">
        They lose access to this workspace immediately. Their account and the print requests they already made are kept, and you can invite
        them back at any time.
      </p>
      <DialogProblem
        title="The member was not removed"
        hint="They still have access to this workspace. Check that they are not the last owner, then try again."
        error={mutation.error?.message}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending && <Spinner />}
          Remove member
        </Button>
      </div>
    </DialogShell>
  )
}
