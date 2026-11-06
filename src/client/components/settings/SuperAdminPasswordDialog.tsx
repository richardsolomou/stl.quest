import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordLengthError } from '../../../core/security'
import type { Account } from '../../../core/types'
import { authClient } from '../../authClient'
import { useI18n } from '../../i18n'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { UserSummary } from '../UserSummary'
import { roleLabel } from './SuperAdminAccessDialogs'

export function SetPasswordDialog({ user, onDone, onSaved }: { user: Account; onDone: () => void; onSaved: (user: Account) => void }) {
  const { t } = useI18n()
  const copy = t.superAdmin.setPassword
  const mutation = useMutation({
    mutationFn: async (password: string) => {
      const { error } = await authClient.admin.setUserPassword({ userId: user.id, newPassword: password })
      if (error) throw new Error(copy.failed(PASSWORD_MIN_LENGTH))
      const { error: revokeError } = await authClient.admin.revokeUserSessions({ userId: user.id })
      if (revokeError) throw new Error(copy.revokeFailed)
    },
    onSuccess: () => {
      onSaved(user)
      onDone()
    },
  })
  const form = useForm({ defaultValues: { password: '' }, onSubmit: ({ value }) => mutation.mutateAsync(value.password) })
  return (
    <DialogShell title={copy.title} onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} role={roleLabel(user, t)} />
      <p className="text-sm text-muted-foreground">{copy.description}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
        className="flex flex-col gap-3"
      >
        <form.Field name="password" validators={{ onChange: ({ value }) => passwordLengthError(value, t) }}>
          {(field) => (
            <Field>
              <FieldLabel htmlFor="set-password">{copy.newPassword}</FieldLabel>
              <Input
                id="set-password"
                type="password"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                autoComplete="new-password"
                required
              />
            </Field>
          )}
        </form.Field>
        <DialogProblem title={copy.problemTitle} hint={copy.problemHint(PASSWORD_MIN_LENGTH)} error={mutation.error?.message} />
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(busy) => (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onDone} disabled={busy}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {busy ? copy.setting : copy.confirm}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form>
    </DialogShell>
  )
}
