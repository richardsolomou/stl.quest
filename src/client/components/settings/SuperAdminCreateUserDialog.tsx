import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordLengthError } from '../../../core/security'
import type { AccountRole } from '../../../core/types'
import { authClient } from '../../authClient'
import { useI18n } from '../../i18n'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { accountRoleOptions } from './SuperAdminUsersTable'
import { MAX_USER_NAME_LENGTH } from '../../../core/identity'

export function CreateUserDialog({ passwordEnabled, onDone }: { passwordEnabled: boolean; onDone: () => void }) {
  const { t } = useI18n()
  const copy = t.superAdmin.createUser
  const roleOptions = accountRoleOptions(t)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (value: { email: string; name: string; password?: string; role: AccountRole }) => {
      const { error } = await authClient.admin.createUser(value)
      if (error) throw new Error(copy.failed)
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
    <DialogShell title={copy.title} onClose={onDone} preventClose={mutation.isPending}>
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
              <FieldLabel htmlFor="user-name">{copy.name}</FieldLabel>
              <Input
                id="user-name"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                maxLength={MAX_USER_NAME_LENGTH}
                required
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="email">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="user-email">{copy.email}</FieldLabel>
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
          <form.Field name="password" validators={{ onChange: ({ value }) => passwordLengthError(value, t) }}>
            {(field) => (
              <Field>
                <FieldLabel htmlFor="user-password">{copy.initialPassword}</FieldLabel>
                <Input
                  id="user-password"
                  type="password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={PASSWORD_MAX_LENGTH}
                  required
                />
              </Field>
            )}
          </form.Field>
        ) : (
          <p className="text-sm text-muted-foreground">{copy.socialOnly}</p>
        )}
        <form.Field name="role">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="user-role">{copy.role}</FieldLabel>
              <Select items={roleOptions} value={field.state.value} onValueChange={(value) => field.handleChange(value as AccountRole)}>
                <SelectTrigger className="w-full" id="user-role">
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
            </Field>
          )}
        </form.Field>
        <DialogProblem title={copy.problemTitle} hint={copy.problemHint} error={mutation.error?.message} />
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(busy) => (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onDone} disabled={busy}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {busy ? copy.creating : copy.confirm}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form>
    </DialogShell>
  )
}
