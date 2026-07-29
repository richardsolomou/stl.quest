import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { PASSWORD_MIN_LENGTH } from '../../../core/security'
import { setOwnPassword } from '../../../server/fns'
import { authClient } from '../../authClient'
import { DialogProblem } from '../DialogProblem'
import type { Notice } from '../SettingNotice'

export function CreatePasswordForm({ onDone }: { onDone: () => void | Promise<void> }) {
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
        maxLength={256}
        autoComplete="new-password"
        placeholder="Create a password"
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button
        type="button"
        size="sm"
        disabled={password.length < PASSWORD_MIN_LENGTH || mutation.isPending}
        onClick={() => mutation.mutate({ data: { password } })}
      >
        {mutation.isPending && <Spinner />}
        {mutation.isPending ? 'Creating…' : 'Create password'}
      </Button>
      <DialogProblem
        title="The password was not created"
        hint={`Use at least ${PASSWORD_MIN_LENGTH} characters, then try again.`}
        error={mutation.error?.message}
      />
    </div>
  )
}

export function ChangePasswordForm({ onDone }: { onDone: (notice: Notice) => void }) {
  const posthog = usePostHog()
  const [error, setError] = useState('')
  const form = useForm({
    defaultValues: { currentPassword: '', newPassword: '' },
    onSubmit: async ({ value }) => {
      setError('')
      const { error: failed } = await authClient.changePassword({ ...value, revokeOtherSessions: true })
      if (failed)
        setError(`Could not change your password. Check your current password and use at least ${PASSWORD_MIN_LENGTH} characters.`)
      else {
        form.reset()
        posthog.capture('password_changed', { other_sessions_revoked: true })
        onDone({
          tone: 'success',
          title: 'Password changed',
          hint: 'Every other device has been signed out. Use the new password next time you sign in.',
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
      <FieldDescription>
        Change the password used with your account email. Saving this also signs you out on every other device.
      </FieldDescription>
      <form.Field name="currentPassword">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
            <Input
              id="current-password"
              type="password"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              maxLength={256}
              autoComplete="current-password"
              required
            />
          </Field>
        )}
      </form.Field>
      <form.Field
        name="newPassword"
        validators={{
          onChange: ({ value }) => (value.length >= PASSWORD_MIN_LENGTH ? undefined : `Use at least ${PASSWORD_MIN_LENGTH} characters`),
        }}
      >
        {(field) => (
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <Input
              id="new-password"
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
        title="Your password was not changed"
        hint="Your existing password still works and no devices were signed out."
        error={error}
      />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(busy) => (
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'Changing…' : 'Change password'}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}
