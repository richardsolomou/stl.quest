import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { Ellipsis, Eye, KeyRound, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { PASSWORD_MIN_LENGTH } from '../../../core/security'
import type { Identity, Role } from '../../../core/types'
import { createInvite, removeWorkspaceMember, revokeInvite, updateWorkspaceMemberRole } from '../../../server/fns'
import { authClient } from '../../authClient'
import { invitesQuery, sessionQuery, usersQuery } from '../../queries'
import { useWorkspaceSlug } from '../../workspace'
import { DialogShell } from '../DialogShell'
import { UserAvatar } from '../UserAvatar'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const ROLE_OPTIONS = [
  { value: 'requester', label: 'Requester' },
  { value: 'admin', label: 'Admin' },
] as const

export function UsersPane({ me }: { me: Identity }) {
  const workspaceSlug = useWorkspaceSlug()
  const { data: users } = useQuery(usersQuery(workspaceSlug))
  const { data: session } = useQuery(sessionQuery(workspaceSlug))
  const passwordEnabled = session?.auth.password !== false
  const smtpConfigured = session?.email.configured === true
  const [adding, setAdding] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [dialog, setDialog] = useState<{ action: UserAction; user: Identity } | null>(null)
  return (
    <SettingsPage>
      <SettingsHeader title="Users" description="Manage admins, requesters, sign-in access, and invitations." />
      <SettingsSection className="p-0 max-sm:[&_td]:px-1.5 max-sm:[&_td:nth-child(2)]:hidden max-sm:[&_th]:px-1.5 max-sm:[&_th:nth-child(2)]:hidden">
        <DataTable
          columns={userColumns({
            me,
            passwordEnabled,
            onAction: (action, user) => setDialog({ action, user }),
          })}
          data={users ?? []}
          search={{ label: 'Search users', placeholder: 'Search users…' }}
          filters={[
            {
              columnId: 'role',
              label: 'Filter users by role',
              allOption: { value: 'all', label: 'All roles' },
              options: ROLE_OPTIONS,
              className: 'w-36',
            },
          ]}
          initialSorting={[
            { id: 'role', desc: false },
            { id: 'name', desc: false },
          ]}
          emptyMessage="No users match these filters."
          itemLabel={{ singular: 'user', plural: 'users' }}
          alignLastColumnRight
        />
      </SettingsSection>
      {dialog?.action === 'impersonate' && <ImpersonateUserDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {dialog?.action === 'role' && <ChangeRoleDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {dialog?.action === 'password' && <SetPasswordDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {dialog?.action === 'remove' && <RemoveMemberDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {adding && <CreateUserDialog passwordEnabled={passwordEnabled} onDone={() => setAdding(false)} />}
      {inviting && <InviteDialog smtpConfigured={smtpConfigured} onDone={() => setInviting(false)} />}
      <SettingsActions>
        <Button type="button" onClick={() => setInviting(true)}>
          Invite user
        </Button>
        {me.deploymentAdmin && (
          <Button type="button" variant="outline" onClick={() => setAdding(true)}>
            Add user
          </Button>
        )}
      </SettingsActions>
      <PendingInvites />
    </SettingsPage>
  )
}

const columnHelper = createColumnHelper<Identity>()
type UserAction = 'impersonate' | 'role' | 'password' | 'remove'

function userColumns({
  me,
  passwordEnabled,
  onAction,
}: {
  me: Identity
  passwordEnabled: boolean
  onAction: (action: UserAction, user: Identity) => void
}): ColumnDef<Identity>[] {
  return [
    columnHelper.accessor('name', {
      header: 'Name',
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <UserAvatar name={row.original.name} image={row.original.image} size="sm" />
          <div className="min-w-0 max-w-28 sm:max-w-none">
            <span className="block truncate">{row.original.name}</span>
            <span className="block truncate text-xs text-muted-foreground sm:hidden">{row.original.email}</span>
          </div>
        </div>
      ),
    }),
    columnHelper.accessor('email', { header: 'Email' }),
    columnHelper.accessor('role', { header: 'Role', cell: RoleCell }),
    columnHelper.display({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) =>
        row.original.id === me.id ? (
          <span className="text-xs text-muted-foreground">You</span>
        ) : (
          <UserActions
            user={row.original}
            passwordEnabled={passwordEnabled}
            impersonating={Boolean(me.impersonatedBy)}
            deploymentAdmin={Boolean(me.deploymentAdmin)}
            onAction={onAction}
          />
        ),
    }),
  ]
}

function UserActions({
  user,
  passwordEnabled,
  impersonating,
  deploymentAdmin,
  onAction,
}: {
  user: Identity
  passwordEnabled: boolean
  impersonating: boolean
  deploymentAdmin: boolean
  onAction: (action: UserAction, user: Identity) => void
}) {
  const [open, setOpen] = useState(false)
  const choose = (action: UserAction) => {
    setOpen(false)
    onAction(action, user)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${user.name}`} />}>
        <Ellipsis />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 gap-0.5 p-1">
        {deploymentAdmin && !impersonating && (
          <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => choose('impersonate')}>
            <Eye />
            View as user
          </Button>
        )}
        {user.workspaceRole !== 'owner' && (
          <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => choose('role')}>
            <ShieldCheck />
            Change role
          </Button>
        )}
        {deploymentAdmin && passwordEnabled && (
          <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => choose('password')}>
            <KeyRound />
            Set password
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

function RoleCell({ getValue }: { getValue: () => Identity['role'] }) {
  const role = getValue()
  return <Badge variant="secondary">{role[0].toUpperCase() + role.slice(1)}</Badge>
}

function InviteDialog({ smtpConfigured, onDone }: { smtpConfigured: boolean; onDone: () => void }) {
  const workspaceSlug = useWorkspaceSlug()
  const callCreateInvite = useServerFn(createInvite)
  const queryClient = useQueryClient()
  const [link, setLink] = useState('')
  const mutation = useMutation({
    mutationFn: callCreateInvite,
    onSuccess: async ({ token, emailed }) => {
      setLink(`${window.location.origin}/invite/${token}`)
      await queryClient.invalidateQueries({ queryKey: ['invites'] })
      if (emailed) toast.success('Invitation emailed.')
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
        <Field>
          <FieldLabel htmlFor="invite-link">Invite link — share it with one person; it works once and expires in 7 days</FieldLabel>
          <InputGroup>
            <InputGroupInput id="invite-link" readOnly value={link} onFocus={(event) => event.target.select()} />
            <InputGroupButton
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(link)
                toast.success('Invite link copied.')
              }}
            >
              Copy
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
        <FieldError>{mutation.error ? 'Could not create the invite.' : null}</FieldError>
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
  const { data: invites } = useQuery(invitesQuery(workspaceSlug))
  const callRevoke = useServerFn(revokeInvite)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: callRevoke,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invites'] })
      toast.success('Invite revoked.')
    },
  })
  if (!invites?.length) return null
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
        <FieldError>{mutation.error ? 'Could not revoke the invite.' : null}</FieldError>
      </SettingsSection>
    </>
  )
}

function UserSummary({ user }: { user: Identity }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <UserAvatar name={user.name} image={user.image} />
      <div className="min-w-0">
        <p className="font-medium">{user.name}</p>
        <p className="truncate text-sm text-muted-foreground">{user.email}</p>
      </div>
      <Badge variant="secondary" className="ml-auto">
        {user.role[0].toUpperCase() + user.role.slice(1)}
      </Badge>
    </div>
  )
}

function ImpersonateUserDialog({ user, onDone }: { user: Identity; onDone: () => void }) {
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.admin.impersonateUser({ userId: user.id })
      if (error) throw new Error(`Could not view PrintHub as ${user.name}.`)
    },
    onSuccess: () => window.location.assign('/'),
  })

  return (
    <DialogShell title="View as user" onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} />
      <p className="text-sm text-muted-foreground">
        You’ll use PrintHub with this user’s permissions for up to one hour, or until you exit impersonation.
      </p>
      <FieldError>{mutation.error?.message}</FieldError>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending && <Spinner />}
          {mutation.isPending ? 'Switching…' : `View as ${user.name}`}
        </Button>
      </div>
    </DialogShell>
  )
}

function ChangeRoleDialog({ user, onDone }: { user: Identity; onDone: () => void }) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const [role, setRole] = useState<Role>(user.role)
  const callUpdateRole = useServerFn(updateWorkspaceMemberRole)
  const mutation = useMutation({
    mutationFn: (nextRole: Role) =>
      callUpdateRole({ data: { workspaceSlug, userId: user.id, role: nextRole === 'admin' ? 'admin' : 'member' } }),
    onSuccess: async (_, nextRole) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['people'] }), queryClient.invalidateQueries({ queryKey: ['users'] })])
      toast.success(`${user.name} is now ${nextRole === 'admin' ? 'an admin' : 'a requester'}.`)
      onDone()
    },
  })

  return (
    <DialogShell title="Change role" onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} />
      <Field>
        <FieldLabel htmlFor={`role-${user.id}`}>Role</FieldLabel>
        <Select items={ROLE_OPTIONS} value={role} onValueChange={(value) => setRole(value as Role)}>
          <SelectTrigger className="w-full" id={`role-${user.id}`} aria-label={`Role for ${user.name}`}>
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
        <FieldDescription>Admins can manage users, settings, and every print request.</FieldDescription>
        <FieldError>{mutation.error?.message}</FieldError>
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="button" disabled={role === user.role || mutation.isPending} onClick={() => mutation.mutate(role)}>
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
      toast.success(`${user.name} was removed from this workspace.`)
      onDone()
    },
  })
  return (
    <DialogShell title="Remove member" onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} />
      <p className="text-sm text-muted-foreground">Their account and existing print requests are preserved.</p>
      <FieldError>{mutation.error?.message}</FieldError>
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

function SetPasswordDialog({ user, onDone }: { user: Identity; onDone: () => void }) {
  const mutation = useMutation({
    mutationFn: async (password: string) => {
      const { error } = await authClient.admin.setUserPassword({ userId: user.id, newPassword: password })
      if (error) throw new Error(`Could not set the password. Use at least ${PASSWORD_MIN_LENGTH} characters.`)
      const { error: revokeError } = await authClient.admin.revokeUserSessions({ userId: user.id })
      if (revokeError) throw new Error('Password changed, but existing sessions could not be revoked.')
    },
    onSuccess: () => {
      toast.success('Password updated and sessions revoked.')
      onDone()
    },
  })
  const form = useForm({
    defaultValues: { password: '' },
    onSubmit: ({ value }) => mutation.mutateAsync(value.password),
  })

  return (
    <DialogShell title="Set password" onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} />
      <p className="text-sm text-muted-foreground">Setting a new password signs this user out everywhere.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
        className="flex flex-col gap-3"
      >
        <form.Field
          name="password"
          validators={{
            onChange: ({ value }) => (value.length >= PASSWORD_MIN_LENGTH ? undefined : `Use at least ${PASSWORD_MIN_LENGTH} characters`),
          }}
        >
          {(field) => (
            <Field>
              <FieldLabel htmlFor="set-password">New password</FieldLabel>
              <Input
                id="set-password"
                type="password"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={256}
                autoComplete="new-password"
                required
              />
            </Field>
          )}
        </form.Field>
        <FieldError>{mutation.error?.message}</FieldError>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(busy) => (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onDone} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {busy ? 'Setting…' : 'Set password'}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form>
    </DialogShell>
  )
}

function CreateUserDialog({ passwordEnabled, onDone }: { passwordEnabled: boolean; onDone: () => void }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (value: { email: string; name: string; password?: string; role: 'requester' | 'admin' }) => {
      const { error } = await authClient.admin.createUser(value)
      if (error) throw new Error('Could not create this user. Check the fields and email address.')
    },
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['people'] }), queryClient.invalidateQueries({ queryKey: ['users'] })])
      toast.success('User created.')
      onDone()
    },
  })
  const form = useForm({
    defaultValues: { email: '', name: '', password: '', role: 'requester' as 'requester' | 'admin' },
    onSubmit: ({ value }) =>
      mutation.mutateAsync({
        email: value.email,
        name: value.name,
        role: value.role,
        password: passwordEnabled ? value.password : undefined,
      }),
  })

  return (
    <DialogShell title="Create user" onClose={onDone}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
        className="flex flex-col gap-3"
      >
        <form.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="user-name">Name</FieldLabel>
              <Input
                id="user-name"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                maxLength={100}
                required
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="email">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="user-email">Email</FieldLabel>
              <Input
                id="user-email"
                type="email"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                maxLength={254}
                required
              />
            </Field>
          )}
        </form.Field>
        {passwordEnabled ? (
          <form.Field
            name="password"
            validators={{
              onChange: ({ value }) => (value.length >= PASSWORD_MIN_LENGTH ? undefined : `Use at least ${PASSWORD_MIN_LENGTH} characters`),
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel htmlFor="user-password">Initial password</FieldLabel>
                <Input
                  id="user-password"
                  type="password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={256}
                  required
                />
              </Field>
            )}
          </form.Field>
        ) : (
          <p className="text-sm text-muted-foreground">
            The user signs in through a configured social provider matching this email address.
          </p>
        )}
        <form.Field name="role">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="user-role">Role</FieldLabel>
              <Select
                items={ROLE_OPTIONS}
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value as 'requester' | 'admin')}
              >
                <SelectTrigger className="w-full" id="user-role">
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
        <FieldError>{mutation.error?.message}</FieldError>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(busy) => (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onDone}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {busy ? 'Creating…' : 'Create user'}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form>
    </DialogShell>
  )
}
