import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordLengthError } from '../../../core/security'
import { setOwnPassword } from '../../../server/fns'
import { authClient } from '../../authClient'
import { useI18n } from '../../i18n'
import { DialogProblem } from '../DialogProblem'
import type { Notice } from '../SettingNotice'

export function CreatePasswordForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const { t } = useI18n()
  const copy = t.account.password
  const callSetPassword = useServerFn(setOwnPassword)
  const [password, setPassword] = useState('')
  const mutation = useMutation({
    mutationFn: callSetPassword,
    onSuccess: async () => {
      setPassword('')
      await onDone()
    },
  })
  return (
    <div className="flex w-full flex-col gap-2">
      <Input
        type="password"
        value={password}
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        autoComplete="new-password"
        placeholder={copy.createPlaceholder}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button
        type="button"
        size="sm"
        disabled={password.length < PASSWORD_MIN_LENGTH || mutation.isPending}
        onClick={() => mutation.mutate({ data: { password } })}
      >
        {mutation.isPending && <Spinner />}
        {mutation.isPending ? copy.creating : copy.create}
      </Button>
      <DialogProblem title={copy.createFailedTitle} hint={copy.createFailedHint(PASSWORD_MIN_LENGTH)} error={mutation.error?.message} />
    </div>
  )
}

export function ChangePasswordForm({ onDone }: { onDone: (notice: Notice) => void }) {
  const { t } = useI18n()
  const copy = t.account.password
  const posthog = usePostHog()
  const [error, setError] = useState('')
  const form = useForm({
    defaultValues: { currentPassword: '', newPassword: '' },
    onSubmit: async ({ value }) => {
      setError('')
      const { error: failed } = await authClient.changePassword({ ...value, revokeOtherSessions: true })
      if (failed) setError(copy.changeFailed(PASSWORD_MIN_LENGTH))
      else {
        form.reset()
        posthog.capture('password_changed', { other_sessions_revoked: true })
        onDone({
          tone: 'success',
          title: copy.changedTitle,
          hint: copy.changedHint,
        })
      }
    },
  })
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className="flex max-w-md flex-col gap-3"
    >
      <FieldDescription>{copy.changeDescription}</FieldDescription>
      <form.Field name="currentPassword">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="current-password">{copy.current}</FieldLabel>
            <Input
              id="current-password"
              type="password"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="current-password"
              required
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="newPassword" validators={{ onChange: ({ value }) => passwordLengthError(value, t) }}>
        {(field) => (
          <Field>
            <FieldLabel htmlFor="new-password">{copy.new}</FieldLabel>
            <Input
              id="new-password"
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
      <DialogProblem title={copy.notChangedTitle} hint={copy.notChangedHint} error={error} />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(busy) => (
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />}
            {busy ? copy.changing : copy.change}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}
