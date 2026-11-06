import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import type { Messages } from '../../../core/i18n'
import type { Account, AccountRole } from '../../../core/types'
import { authClient } from '../../authClient'
import { useI18n } from '../../i18n'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { UserSummary } from '../UserSummary'
import { accountRoleOptions } from './SuperAdminUsersTable'

export const roleLabel = (user: Account, t: Messages) => t.superAdmin.roles[user.role]

export function ImpersonateUserDialog({ user, onDone }: { user: Account; onDone: () => void }) {
  const { t } = useI18n()
  const copy = t.superAdmin.impersonate
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.admin.impersonateUser({ userId: user.id })
      if (error) throw new Error(copy.failed(user.name))
    },
    onSuccess: () => window.location.assign('/'),
  })
  return (
    <DialogShell title={copy.title} onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} role={roleLabel(user, t)} />
      <p className="text-sm text-muted-foreground">{copy.description}</p>
      <DialogProblem title={copy.problemTitle} hint={copy.problemHint} error={mutation.error?.message} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          {t.common.cancel}
        </Button>
        <Button type="button" className="ph-no-capture" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending && <Spinner />}
          {mutation.isPending ? copy.switching : copy.confirm(user.name)}
        </Button>
      </div>
    </DialogShell>
  )
}

export function ChangeServerRoleDialog({ user, onDone }: { user: Account; onDone: () => void }) {
  const { t } = useI18n()
  const copy = t.superAdmin.changeRole
  const options = accountRoleOptions(t)
  const queryClient = useQueryClient()
  const [role, setRole] = useState<AccountRole>(user.role)
  const mutation = useMutation({
    mutationFn: async (nextRole: AccountRole) => {
      const { error } = await authClient.admin.setRole({ userId: user.id, role: nextRole })
      if (error) throw new Error(copy.failed)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      onDone()
    },
  })
  return (
    <DialogShell title={copy.title} onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} role={roleLabel(user, t)} />
      <Field>
        <FieldLabel htmlFor={`server-role-${user.id}`}>{copy.role}</FieldLabel>
        <Select items={options} value={role} onValueChange={(value) => setRole(value as AccountRole)}>
          <SelectTrigger className="ph-no-capture w-full" id={`server-role-${user.id}`} aria-label={copy.roleFor(user.name)}>
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
        <FieldDescription>{copy.description}</FieldDescription>
      </Field>
      <DialogProblem title={copy.problemTitle} hint={copy.problemHint} error={mutation.error?.message} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          {t.common.cancel}
        </Button>
        <Button type="button" disabled={role === user.role || mutation.isPending} onClick={() => mutation.mutate(role)}>
          {mutation.isPending && <Spinner />}
          {mutation.isPending ? t.common.saving : copy.confirm}
        </Button>
      </div>
    </DialogShell>
  )
}
