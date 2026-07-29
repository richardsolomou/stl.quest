import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { normalizeEmail } from '../../../core/identity'
import { PASSWORD_MAX_LENGTH } from '../../../core/security'
import { changeOwnEmail } from '../../../server/fns'
import { authClient } from '../../authClient'
import { DialogProblem } from '../DialogProblem'
import type { Notice } from '../SettingNotice'

export function AccountProfileForm({
  name,
  email,
  emailConfigured,
  hasPassword,
  onDone,
}: {
  name: string
  email: string
  emailConfigured: boolean
  hasPassword: boolean
  onDone: (notice?: Notice) => void | Promise<void>
}) {
  const posthog = usePostHog()
  const [error, setError] = useState('')
  const queryClient = useQueryClient()
  const changeEmail = useServerFn(changeOwnEmail)
  const form = useForm({
    defaultValues: { name, email, currentPassword: '' },
    onSubmit: async ({ value }) => {
      setError('')
      const nextName = value.name.trim()
      const nextEmail = normalizeEmail(value.email)
      if (!nextName) {
        setError('Name is required.')
        return
      }
      if (nextName !== name) {
        const { error: failed } = await authClient.updateUser({ name: nextName })
        if (failed) {
          setError('Could not update your name.')
          return
        }
        await queryClient.invalidateQueries({ queryKey: ['session'] })
      }
      if (nextEmail !== email) {
        try {
          await changeEmail({ data: { email: nextEmail, password: value.currentPassword } })
        } catch {
          setError(
            !hasPassword
              ? 'Create a password sign-in method before changing your email address.'
              : emailConfigured
                ? 'Could not change your email address. Check your current password.'
                : 'Email verification must be configured to change this email address.',
          )
          return
        }
      }
      posthog.capture('account_profile_updated', { name_changed: nextName !== name, email_change_requested: nextEmail !== email })
      await onDone(
        nextEmail === email
          ? undefined
          : {
              tone: 'success',
              title: 'Email change requested',
              hint: `Check ${nextEmail} for a verification link. Your current address keeps working until you confirm.`,
            },
      )
    },
  })
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name="name">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="profile-name">Name</FieldLabel>
            <Input
              id="profile-name"
              value={field.state.value}
              maxLength={100}
              onChange={(event) => field.handleChange(event.target.value)}
              required
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="email">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="profile-email">Email address</FieldLabel>
            <Input
              id="profile-email"
              type="email"
              value={field.state.value}
              maxLength={254}
              onChange={(event) => field.handleChange(event.target.value)}
              required
            />
            {emailConfigured && <FieldDescription>A verification link may be sent to the new address.</FieldDescription>}
          </Field>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.email}>
        {(currentEmail) =>
          email !== normalizeEmail(currentEmail) &&
          hasPassword && (
            <form.Field name="currentPassword">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="profile-current-password">Current password</FieldLabel>
                  <Input
                    id="profile-current-password"
                    type="password"
                    value={field.state.value}
                    maxLength={PASSWORD_MAX_LENGTH}
                    onChange={(event) => field.handleChange(event.target.value)}
                    required
                  />
                  <FieldDescription>Confirm your password to change the account email.</FieldDescription>
                </Field>
              )}
            </form.Field>
          )
        }
      </form.Subscribe>
      <DialogProblem
        title="Your profile was not saved"
        hint="Nothing has changed yet. Check the fields above and try again."
        error={error}
      />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(busy) => (
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'Saving…' : 'Save profile'}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}
