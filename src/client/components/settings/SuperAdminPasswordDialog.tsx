import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { PASSWORD_MIN_LENGTH } from '../../../core/security'
import type { Account } from '../../../core/types'
import { authClient } from '../../authClient'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { UserSummary } from '../UserSummary'

export function SetPasswordDialog({ user, onDone, onSaved }: { user: Account; onDone: () => void; onSaved: (user: Account) => void }) {
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
  const form = useForm({ defaultValues: { password: '' }, onSubmit: ({ value }) => mutation.mutateAsync(value.password) })
  return (
    <DialogShell title="Set password" onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} role={user.role === 'super_admin' ? 'Super admin' : 'User'} />
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
