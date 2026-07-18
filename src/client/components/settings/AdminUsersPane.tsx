import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { Ellipsis, Eye, KeyRound, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { PASSWORD_MIN_LENGTH } from '../../../core/security'
import type { Identity, Role } from '../../../core/types'
import { authClient } from '../../authClient'
import { deploymentUsersQuery, sessionQuery } from '../../queries'
import { DialogShell } from '../DialogShell'
import { UserAvatar } from '../UserAvatar'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const ROLE_OPTIONS = [
  { value: 'requester', label: 'User' },
  { value: 'admin', label: 'Deployment admin' },
] as const

const columnHelper = createColumnHelper<Identity>()
type UserAction = 'impersonate' | 'role' | 'password'

export function AdminUsersPane() {
  const { data: users } = useQuery(deploymentUsersQuery())
  const { data: session } = useQuery(sessionQuery())
  const me = session?.identity
  const passwordEnabled = session?.auth.password !== false
  const [adding, setAdding] = useState(false)
  const [dialog, setDialog] = useState<{ action: UserAction; user: Identity } | null>(null)

  return (
    <SettingsPage>
      <SettingsHeader title="Users" description="Manage every account and deployment administrator." />
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
              className: 'w-44',
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
      {dialog?.action === 'role' && <ChangeDeploymentRoleDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {dialog?.action === 'password' && <SetPasswordDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {adding && <CreateUserDialog passwordEnabled={passwordEnabled} onDone={() => setAdding(false)} />}
      <SettingsActions>
        <Button type="button" onClick={() => setAdding(true)}>
          Add user
        </Button>
      </SettingsActions>
    </SettingsPage>
  )
}

function userColumns({
  me,
  passwordEnabled,
  onAction,
}: {
  me?: Identity
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
    columnHelper.accessor('role', { header: 'Role', cell: DeploymentRoleCell }),
    columnHelper.display({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) =>
        row.original.id === me?.id ? (
          <span className="text-xs text-muted-foreground">You</span>
        ) : (
          <UserActions user={row.original} passwordEnabled={passwordEnabled} onAction={onAction} />
        ),
    }),
  ]
}

function UserActions({
  user,
  passwordEnabled,
  onAction,
}: {
  user: Identity
  passwordEnabled: boolean
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
      <PopoverContent align="end" className="w-52 gap-0.5 p-1">
        <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => choose('impersonate')}>
          <Eye />
          View as user
        </Button>
        <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => choose('role')}>
          <ShieldCheck />
          Change deployment role
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

function DeploymentRoleCell({ getValue }: { getValue: () => Identity['role'] }) {
  return <Badge variant="secondary">{getValue() === 'admin' ? 'Deployment admin' : 'User'}</Badge>
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
        {user.role === 'admin' ? 'Deployment admin' : 'User'}
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

function ChangeDeploymentRoleDialog({ user, onDone }: { user: Identity; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [role, setRole] = useState<Role>(user.role)
  const mutation = useMutation({
    mutationFn: async (nextRole: Role) => {
      const { error } = await authClient.admin.setRole({ userId: user.id, role: nextRole })
      if (error) throw new Error('Could not change this deployment role.')
    },
    onSuccess: async (_, nextRole) => {
      await queryClient.invalidateQueries({ queryKey: ['deployment-users'] })
      toast.success(`${user.name} is now ${nextRole === 'admin' ? 'a deployment admin' : 'a user'}.`)
      onDone()
    },
  })

  return (
    <DialogShell title="Change deployment role" onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} />
      <Field>
        <FieldLabel htmlFor={`deployment-role-${user.id}`}>Role</FieldLabel>
        <Select items={ROLE_OPTIONS} value={role} onValueChange={(value) => setRole(value as Role)}>
          <SelectTrigger className="w-full" id={`deployment-role-${user.id}`} aria-label={`Deployment role for ${user.name}`}>
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
        <FieldDescription>Deployment admins can manage all accounts, authentication, telemetry, and diagnostics.</FieldDescription>
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
    mutationFn: async (value: { email: string; name: string; password?: string; role: Role }) => {
      const { error } = await authClient.admin.createUser(value)
      if (error) throw new Error('Could not create this user. Check the fields and email address.')
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['deployment-users'] })
      toast.success('User created.')
      onDone()
    },
  })
  const form = useForm({
    defaultValues: { email: '', name: '', password: '', role: 'requester' as Role },
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
              <Select items={ROLE_OPTIONS} value={field.state.value} onValueChange={(value) => field.handleChange(value as Role)}>
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
