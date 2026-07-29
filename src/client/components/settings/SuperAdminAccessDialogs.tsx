import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import type { Account, AccountRole } from '../../../core/types'
import { authClient } from '../../authClient'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { UserSummary } from '../UserSummary'
import { accountRoleOptions } from './SuperAdminUsersTable'

const roleLabel = (user: Account) => (user.role === 'super_admin' ? 'Super admin' : 'User')

export function ImpersonateUserDialog({ user, onDone }: { user: Account; onDone: () => void }) {
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.admin.impersonateUser({ userId: user.id })
      if (error) throw new Error(`Could not view STL Quest as ${user.name}.`)
    },
    onSuccess: () => window.location.assign('/'),
  })
  return (
    <DialogShell title="View as user" onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} role={roleLabel(user)} />
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

export function ChangeServerRoleDialog({ user, onDone }: { user: Account; onDone: () => void }) {
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
      <UserSummary user={user} role={roleLabel(user)} />
      <Field>
        <FieldLabel htmlFor={`server-role-${user.id}`}>Role</FieldLabel>
        <Select items={accountRoleOptions} value={role} onValueChange={(value) => setRole(value as AccountRole)}>
          <SelectTrigger className="ph-no-capture w-full" id={`server-role-${user.id}`} aria-label={`Server role for ${user.name}`}>
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
