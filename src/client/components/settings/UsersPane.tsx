import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { Ellipsis, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import type { Identity, WorkspaceRole } from '../../../core/types'
import { createInvite, removeWorkspaceMember, revokeInvite, updateWorkspaceMemberRole } from '../../../server/fns'
import { invitesQuery, sessionQuery, usersQuery } from '../../queries'
import { retryQueries } from '../../queryState'
import { useWorkspaceSlug } from '../../workspace'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { SettingNotice, noticeDetail } from '../SettingNotice'
import { CopyButtonLabel, useCopied } from '../useCopied'
import { QueryState } from '../QueryState'
import { ProtectedEmail } from '../ProtectedEmail'
import { UserTableIdentity } from '../UserTableIdentity'
import { UserSummary } from '../UserSummary'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const ROLE_OPTIONS = [
  { value: 'requester', label: 'Requester' },
  { value: 'admin', label: 'Admin' },
] as const

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
        <Button type="button" onClick={() => setInviting(true)}>
          Invite user
        </Button>
      </SettingsActions>
      <PendingInvites />
    </SettingsPage>
  )
}

const columnHelper = createColumnHelper<Identity>()
type UserAction = 'role' | 'remove'
type WorkspaceAccess = 'admin' | 'member'
const workspaceRoleLabel = (user: Identity) =>
  user.workspaceRole === 'owner' ? 'Owner' : user.workspaceRole === 'admin' ? 'Admin' : 'Member'

function userColumns({ me, onAction }: { me: Identity; onAction: (action: UserAction, user: Identity) => void }): ColumnDef<Identity>[] {
  return [
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
  ]
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
          <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => choose('role')}>
            <ShieldCheck />
            Change role
          </Button>
        )}
        {user.workspaceRole !== 'owner' && (
          <Button type="button" variant="ghost" className="w-full justify-start text-destructive" onClick={() => choose('remove')}>
            <Trash2 />
            Remove member
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function InviteDialog({ smtpConfigured, onDone }: { smtpConfigured: boolean; onDone: () => void }) {
  const workspaceSlug = useWorkspaceSlug()
  const callCreateInvite = useServerFn(createInvite)
  const queryClient = useQueryClient()
  const [link, setLink] = useState('')
  const [emailedTo, setEmailedTo] = useState<string>()
  const { copied, copy } = useCopied()
  const mutation = useMutation({
    mutationFn: callCreateInvite,
    onSuccess: async ({ token, emailed }, variables) => {
      setLink(`${window.location.origin}/invite/${token}`)
      setEmailedTo(emailed ? variables.data.email : undefined)
      await queryClient.invalidateQueries({ queryKey: ['invites'] })
    },
  })
  const form = useForm({
    defaultValues: { role: 'requester' as 'requester' | 'admin', label: '', email: '' },
    onSubmit: ({ value }) =>
      mutation.mutateAsync({
        data: { workspaceSlug, role: value.role, label: value.label.trim() || undefined, email: value.email.trim() || undefined },
      }),
  })

  if (link) {
    return (
      <DialogShell title="Invite link" onClose={onDone}>
        <p className="text-sm text-muted-foreground">Share this single-use link with one person. It expires in seven days.</p>
        {emailedTo && (
          <SettingNotice
            notice={{ tone: 'success', title: 'Invitation emailed', hint: `Sent to ${emailedTo}. The link below is the same one.` }}
          />
        )}
        <Field>
          <FieldLabel htmlFor="invite-link">Invite link — share it with one person; it works once and expires in 7 days</FieldLabel>
          <InputGroup>
            <InputGroupInput id="invite-link" readOnly value={link} onFocus={(event) => event.target.select()} />
            <InputGroupButton variant="ghost" onClick={() => copy(link)}>
              <CopyButtonLabel copied={copied} />
            </InputGroupButton>
          </InputGroup>
          <FieldDescription>
            This is the only time the link is shown. They can continue with a password, Google, or Discord.
          </FieldDescription>
        </Field>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onDone}>
            Done
          </Button>
        </div>
      </DialogShell>
    )
  }

  return (
    <DialogShell title="Create invite link" onClose={onDone}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
        className="flex flex-col gap-3"
      >
        {smtpConfigured && (
          <form.Field name="email">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="invite-email">Email invitation to (optional)</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  maxLength={254}
                  placeholder="person@example.com"
                />
                <FieldDescription>Leave blank to create a link without sending email.</FieldDescription>
              </Field>
            )}
          </form.Field>
        )}
        <form.Field name="label">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="invite-label">Who is this for? (optional note to yourself)</FieldLabel>
              <Input
                id="invite-label"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                maxLength={100}
                placeholder="New team member"
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="role">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="invite-role">Role</FieldLabel>
              <Select
                items={ROLE_OPTIONS}
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value as 'requester' | 'admin')}
              >
                <SelectTrigger className="w-full" id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>
        <DialogProblem
          title="The invite was not created"
          hint="Check the email address if you entered one, then try again."
          error={mutation.error ? (noticeDetail(mutation.error) ?? 'No further detail was returned.') : undefined}
        />
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(busy) => (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onDone}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {busy ? 'Creating…' : smtpConfigured ? 'Create invitation' : 'Create invite link'}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form>
    </DialogShell>
  )
}

function PendingInvites() {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(invitesQuery(workspaceSlug))
  const invites = query.data
  const callRevoke = useServerFn(revokeInvite)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: callRevoke,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  })
  if (!invites) {
    return (
      <SettingsSection title="Pending invites">
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel="Loading pending invites…"
          errorTitle="Could not load pending invites"
          onRetry={() => void query.refetch()}
        />
      </SettingsSection>
    )
  }
  if (!invites.length) return null
  return (
    <>
      <SettingsSection title="Pending invites">
        <ItemGroup>
          {invites.map((invite) => (
            <Item variant="outline" key={invite.id}>
              <ItemContent>
                <ItemTitle>{invite.label || 'Unlabeled invite'}</ItemTitle>
                <ItemDescription>Expires {new Date(invite.expiresAt).toLocaleDateString()}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant="secondary">{invite.role}</Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={mutation.isPending && mutation.variables?.data.id === invite.id}
                  onClick={() => mutation.mutate({ data: { workspaceSlug, id: invite.id } })}
                >
                  Revoke
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
        {mutation.error && (
          <SettingNotice
            notice={{
              tone: 'error',
              title: 'The invite was not revoked',
              hint: 'It is still listed above and still usable. Try again in a moment.',
              detail: noticeDetail(mutation.error),
            }}
          />
        )}
      </SettingsSection>
    </>
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
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['people'] }), queryClient.invalidateQueries({ queryKey: ['users'] })])
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
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['people'] }), queryClient.invalidateQueries({ queryKey: ['users'] })])
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
