import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { PASSWORD_MIN_LENGTH } from '../../../core/security'
import type { Account, AccountRole } from '../../../core/types'
import { authClient } from '../../authClient'
import { accountsQuery, sessionQuery } from '../../queries'
import { retryQueries } from '../../queryState'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { SettingNotice, type Notice } from '../SettingNotice'
import { QueryState } from '../QueryState'
import { ChangeServerRoleDialog, ImpersonateUserDialog } from './SuperAdminAccessDialogs'
import { SetPasswordDialog } from './SuperAdminPasswordDialog'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { accountRoleOptions, superAdminUserColumns, type SuperAdminUserAction } from './SuperAdminUsersTable'

export function SuperAdminUsersPane() {
  const usersResult = useQuery(accountsQuery())
  const sessionResult = useQuery(sessionQuery())
  const users = usersResult.data
  const session = sessionResult.data
  const me = session?.identity
  const passwordEnabled = session?.auth.password !== false
  const [adding, setAdding] = useState(false)
  const [dialog, setDialog] = useState<{ action: SuperAdminUserAction; user: Account } | null>(null)
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
          columns={superAdminUserColumns({
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
              options: accountRoleOptions,
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
              <Select
                items={accountRoleOptions}
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value as AccountRole)}
              >
                <SelectTrigger className="w-full" id="user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountRoleOptions.map((option) => (
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
