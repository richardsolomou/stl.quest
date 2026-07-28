import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { Ellipsis, Eye, KeyRound, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { PASSWORD_MIN_LENGTH } from '../../../core/security'
import type { Account, AccountRole, Identity } from '../../../core/types'
import { authClient } from '../../authClient'
import { accountsQuery, sessionQuery } from '../../queries'
import { retryQueries } from '../../queryState'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { SettingNotice, type Notice } from '../SettingNotice'
import { QueryState } from '../QueryState'
import { ProtectedEmail } from '../ProtectedEmail'
import { UserAvatar } from '../UserAvatar'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const ROLE_OPTIONS = [
  { value: 'requester', label: 'User' },
  { value: 'super_admin', label: 'Super admin' },
] as const

const columnHelper = createColumnHelper<Account>()
type UserAction = 'impersonate' | 'role' | 'password'

export function SuperAdminUsersPane() {
  const usersResult = useQuery(accountsQuery())
  const sessionResult = useQuery(sessionQuery())
  const users = usersResult.data
  const session = sessionResult.data
  const me = session?.identity
  const passwordEnabled = session?.auth.password !== false
  const [adding, setAdding] = useState(false)
  const [dialog, setDialog] = useState<{ action: UserAction; user: Account } | null>(null)
  // Role changes and new users show up in the table below; a reset password leaves no trace there, so it says so here.
  const [notice, setNotice] = useState<Notice>()

  if (!users || !session) {
    return (
      <SettingsPage>
        <SettingsHeader title="Users" description="Manage every account and super admin." />
        <QueryState
          loading={usersResult.isPending || sessionResult.isPending}
          error={usersResult.error ?? sessionResult.error}
          loadingLabel="Loading users…"
          errorTitle="Could not load users"
          onRetry={() => void retryQueries(usersResult.refetch, sessionResult.refetch)}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage>
      <SettingsHeader title="Users" description="Manage every account and super admin." />
      <SettingNotice notice={notice} />
      <SettingsSection className="p-0 max-sm:[&_td]:px-1.5 max-sm:[&_td:nth-child(2)]:hidden max-sm:[&_th]:px-1.5 max-sm:[&_th:nth-child(2)]:hidden">
        <DataTable
          columns={userColumns({
            me,
            passwordEnabled,
            onAction: (action, user) => {
              setNotice(undefined)
              setDialog({ action, user })
            },
          })}
          data={users}
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
          initialSorting={[{ id: 'lastOnlineAt', desc: true }]}
          sortingStorageKey="stlquest:super-admin-users:sorting"
          columnVisibility={{
            storageKey: 'stlquest:super-admin-users:columns',
            initial: { updatedAt: false },
            labels: {
              email: 'Email',
              role: 'Role',
              createdAt: 'Created',
              updatedAt: 'Updated',
              lastOnlineAt: 'Last online',
              workspaceCount: 'Workspaces',
            },
          }}
          emptyMessage="No users match these filters."
          itemLabel={{ singular: 'user', plural: 'users' }}
          alignLastColumnRight
        />
      </SettingsSection>
      {dialog?.action === 'impersonate' && <ImpersonateUserDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {dialog?.action === 'role' && <ChangeServerRoleDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {dialog?.action === 'password' && (
        <SetPasswordDialog
          user={dialog.user}
          onDone={() => setDialog(null)}
          onSaved={(user) =>
            setNotice({
              tone: 'success',
              title: `New password set for ${user.name}`,
              hint: 'They have been signed out everywhere and need the new password to sign back in.',
            })
          }
        />
      )}
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
  onAction: (action: UserAction, user: Account) => void
}): ColumnDef<Account>[] {
  return [
    columnHelper.accessor('name', {
      header: 'Name',
      cell: ({ row }) => (
        <div className="ph-no-capture flex items-center gap-2.5">
          <UserAvatar name={row.original.name} image={row.original.image} size="sm" />
          <div className="min-w-0 max-w-28 sm:max-w-none">
            <span className="block truncate">{row.original.name}</span>
            <ProtectedEmail email={row.original.email} className="block text-xs text-muted-foreground sm:hidden" />
          </div>
        </div>
      ),
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
      cell: ({ row }) =>
        row.original.id === me?.id ? (
          <span className="text-xs text-muted-foreground">You</span>
        ) : (
          <UserActions user={row.original} passwordEnabled={passwordEnabled} onAction={onAction} />
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
  onAction: (action: UserAction, user: Account) => void
}) {
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

function UserSummary({ user }: { user: Account }) {
  return (
    <div className="ph-no-capture flex items-center gap-3 rounded-lg border p-3">
      <UserAvatar name={user.name} image={user.image} />
      <div className="min-w-0">
        <p className="font-medium">{user.name}</p>
        <ProtectedEmail email={user.email} className="block text-sm text-muted-foreground" />
      </div>
      <Badge variant="secondary" className="ml-auto">
        {user.role === 'super_admin' ? 'Super admin' : 'User'}
      </Badge>
    </div>
  )
}

function ImpersonateUserDialog({ user, onDone }: { user: Account; onDone: () => void }) {
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.admin.impersonateUser({ userId: user.id })
      if (error) throw new Error(`Could not view STL Quest as ${user.name}.`)
    },
    onSuccess: () => window.location.assign('/'),
  })

  return (
    <DialogShell title="View as user" onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} />
      <p className="text-sm text-muted-foreground">
        You’ll use STL Quest with this user’s permissions for up to one hour, or until you exit impersonation.
      </p>
      <DialogProblem
        title="Could not switch to this user"
        hint="You are still signed in as yourself. Try again in a moment."
        error={mutation.error?.message}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="button" className="ph-no-capture" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending && <Spinner />}
          {mutation.isPending ? 'Switching…' : `View as ${user.name}`}
        </Button>
      </div>
    </DialogShell>
  )
}

function ChangeServerRoleDialog({ user, onDone }: { user: Account; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [role, setRole] = useState<AccountRole>(user.role)
  const mutation = useMutation({
    mutationFn: async (nextRole: AccountRole) => {
      const { error } = await authClient.admin.setRole({ userId: user.id, role: nextRole })
      if (error) throw new Error('Could not change this server role.')
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      onDone()
    },
  })

  return (
    <DialogShell title="Change server role" onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} />
      <Field>
        <FieldLabel htmlFor={`server-role-${user.id}`}>Role</FieldLabel>
        <Select items={ROLE_OPTIONS} value={role} onValueChange={(value) => setRole(value as AccountRole)}>
          <SelectTrigger className="ph-no-capture w-full" id={`server-role-${user.id}`} aria-label={`Server role for ${user.name}`}>
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
        <FieldDescription>Super admins can manage all accounts, authentication, telemetry, and diagnostics.</FieldDescription>
      </Field>
      <DialogProblem
        title="The server role was not changed"
        hint="A deployment must keep at least one super admin, and you cannot remove your own super admin role."
        error={mutation.error?.message}
      />
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

function SetPasswordDialog({ user, onDone, onSaved }: { user: Account; onDone: () => void; onSaved: (user: Account) => void }) {
  const mutation = useMutation({
    mutationFn: async (password: string) => {
      const { error } = await authClient.admin.setUserPassword({ userId: user.id, newPassword: password })
      if (error) throw new Error(`Could not set the password. Use at least ${PASSWORD_MIN_LENGTH} characters.`)
      const { error: revokeError } = await authClient.admin.revokeUserSessions({ userId: user.id })
      if (revokeError) throw new Error('Password changed, but existing sessions could not be revoked.')
    },
    onSuccess: () => {
      onSaved(user)
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
        <DialogProblem
          title="The password was not changed"
          hint={`Their current password still works. Use at least ${PASSWORD_MIN_LENGTH} characters and try again.`}
          error={mutation.error?.message}
        />
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
    mutationFn: async (value: { email: string; name: string; password?: string; role: AccountRole }) => {
      const { error } = await authClient.admin.createUser(value)
      if (error) throw new Error('Could not create this user. Check the fields and email address.')
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      onDone()
    },
  })
  const form = useForm({
    defaultValues: { email: '', name: '', password: '', role: 'requester' as AccountRole },
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
              <Select items={ROLE_OPTIONS} value={field.state.value} onValueChange={(value) => field.handleChange(value as AccountRole)}>
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
        <DialogProblem
          title="The account was not created"
          hint="Check the email address is valid and not already registered."
          error={mutation.error?.message}
        />
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
