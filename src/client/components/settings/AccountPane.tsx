import { useEffect, useState, type ReactNode } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import QRCode from 'qrcode'
import { Check, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { SOCIAL_AUTH_PROVIDERS, type SocialAuthProvider } from '../../../core/auth'
import { PASSWORD_MIN_LENGTH } from '../../../core/security'
import type { Identity } from '../../../core/types'
import { changeOwnEmail, setOwnPassword, unlinkOwnAccount } from '../../../server/fns'
import { authClient } from '../../authClient'
import { accountMethodsQuery, sessionQuery } from '../../queries'
import { retryQueries } from '../../queryState'
import { AuthMethodIcon } from '../AuthMethodIcon'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { QueryState } from '../QueryState'
import { SettingNotice, type Notice } from '../SettingNotice'
import { SettingRow } from '../SettingRow'
import { useCopied } from '../useCopied'
import { ProtectedEmail } from '../ProtectedEmail'
import { UserAvatar } from '../UserAvatar'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const PROVIDER_NAMES: Record<SocialAuthProvider, string> = { google: 'Google', discord: 'Discord' }

export function AccountPane({ me }: { me: Identity }) {
  const queryClient = useQueryClient()
  const sessionResult = useQuery(sessionQuery())
  const methodsResult = useQuery(accountMethodsQuery())
  const session = sessionResult.data
  const methods = methodsResult.data
  const linked = new Set(methods?.linked ?? [])
  const hasPassword = linked.has('credential')
  const usableLinkedMethods =
    Number(hasPassword && methods?.passwordAvailable) + (methods?.availableProviders.filter((provider) => linked.has(provider)).length ?? 0)
  const [changingPassword, setChangingPassword] = useState(false)
  const [creatingPassword, setCreatingPassword] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [removingMethod, setRemovingMethod] = useState<'credential' | SocialAuthProvider>()
  const [settingUpTwoFactor, setSettingUpTwoFactor] = useState(false)
  const [disablingTwoFactor, setDisablingTwoFactor] = useState(false)
  // Badges and the profile header already show most of these results; a notice is only for what leaves no visible trace.
  const [notice, setNotice] = useState<Notice>()
  if (!session || !methods) {
    return (
      <SettingsPage>
        <SettingsHeader title="Account" description="Manage your profile and sign-in methods." />
        <QueryState
          loading={sessionResult.isPending || methodsResult.isPending}
          error={sessionResult.error ?? methodsResult.error}
          loadingLabel="Loading account settings…"
          errorTitle="Could not load account settings"
          onRetry={() => void retryQueries(sessionResult.refetch, methodsResult.refetch)}
        />
      </SettingsPage>
    )
  }
  return (
    <SettingsPage>
      <SettingsHeader title="Account" description="Manage your profile and sign-in methods." />
      <SettingNotice notice={notice} />
      <SettingsSection title="Profile" description="Choose how your account is identified in STL Quest.">
        <div className="flex items-center gap-3">
          <UserAvatar name={me.name} image={me.image} size="lg" />
          <div>
            <h3 className="ph-no-capture font-medium">{me.name}</h3>
            <ProtectedEmail email={me.email} className="block text-sm text-muted-foreground" />
          </div>
          <Button type="button" variant="outline" className="ml-auto" onClick={() => setEditingProfile(true)}>
            Edit profile
          </Button>
        </div>
      </SettingsSection>
      <SettingsSection
        title="Two-factor authentication"
        description="Require an authenticator app or one-time recovery code after password sign-in."
      >
        <SettingRow
          icon={<ShieldCheck />}
          name="Authenticator app"
          status={{
            label: me.twoFactorEnabled ? 'Enabled' : hasPassword ? 'Not set up' : 'Needs a password',
            tone: me.twoFactorEnabled ? 'on' : hasPassword ? 'ready' : 'off',
          }}
          detail={
            me.twoFactorEnabled
              ? 'Your password sign-in is protected with a second factor.'
              : hasPassword
                ? 'Add a time-based code from apps such as 1Password, Authy, or Google Authenticator.'
                : 'Create a password sign-in method below before enabling two-factor authentication.'
          }
          actions={
            me.twoFactorEnabled ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setDisablingTwoFactor(true)}>
                Turn off
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" disabled={!hasPassword} onClick={() => setSettingUpTwoFactor(true)}>
                Set up
              </Button>
            )
          }
        />
      </SettingsSection>
      <SettingsSection title="Sign-in methods" description="Link multiple methods so you always have another way into your account.">
        <div className="flex flex-col gap-2">
          <MethodRow
            method="password"
            name="Password"
            linked={hasPassword}
            available={methods?.passwordAvailable ?? false}
            action={
              hasPassword && session?.auth.password ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setChangingPassword(true)}>
                    Change password
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={usableLinkedMethods < 2}
                    onClick={() => setRemovingMethod('credential')}
                  >
                    Remove password
                  </Button>
                </div>
              ) : methods?.passwordAvailable ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setCreatingPassword(true)}>
                  Create password
                </Button>
              ) : undefined
            }
          />
          {SOCIAL_AUTH_PROVIDERS.filter((provider) => linked.has(provider) || methods.availableProviders.includes(provider)).map(
            (provider) => (
              <MethodRow
                key={provider}
                method={provider}
                name={PROVIDER_NAMES[provider]}
                linked={linked.has(provider)}
                available={methods.availableProviders.includes(provider)}
                action={
                  linked.has(provider) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={usableLinkedMethods < 2}
                      onClick={() => setRemovingMethod(provider)}
                    >
                      Unlink {PROVIDER_NAMES[provider]}
                    </Button>
                  ) : methods.availableProviders.includes(provider) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void authClient.linkSocial({ provider, callbackURL: '/account', errorCallbackURL: '/account' })}
                    >
                      <AuthMethodIcon method={provider} /> Link {PROVIDER_NAMES[provider]}
                    </Button>
                  ) : undefined
                }
              />
            ),
          )}
        </div>
      </SettingsSection>
      {editingProfile && (
        <DialogShell title="Edit profile" onClose={() => setEditingProfile(false)}>
          <ProfileForm
            name={me.name}
            email={me.email}
            emailConfigured={session.email.configured}
            hasPassword={hasPassword}
            onDone={async (result) => {
              setEditingProfile(false)
              setNotice(result)
              await queryClient.invalidateQueries({ queryKey: ['session'] })
            }}
          />
        </DialogShell>
      )}
      {removingMethod && (
        <DialogShell
          title={removingMethod === 'credential' ? 'Remove password sign-in' : `Unlink ${PROVIDER_NAMES[removingMethod]}`}
          onClose={() => setRemovingMethod(undefined)}
        >
          <RemoveMethodForm
            method={removingMethod}
            onDone={async () => {
              setRemovingMethod(undefined)
              await queryClient.invalidateQueries({ queryKey: ['account-methods'] })
            }}
          />
        </DialogShell>
      )}
      {creatingPassword && (
        <DialogShell
          title="Create a password"
          description="This adds email and password sign-in to your account, alongside any linked providers."
          onClose={() => setCreatingPassword(false)}
        >
          <CreatePasswordForm
            onDone={async () => {
              setCreatingPassword(false)
              await queryClient.invalidateQueries({ queryKey: ['account-methods'] })
            }}
          />
        </DialogShell>
      )}
      {changingPassword && (
        <DialogShell title="Change password" onClose={() => setChangingPassword(false)}>
          <ChangePasswordForm
            onDone={(changed) => {
              setChangingPassword(false)
              setNotice(changed)
            }}
          />
        </DialogShell>
      )}
      {settingUpTwoFactor && (
        <DialogShell title="Set up two-factor authentication" onClose={() => setSettingUpTwoFactor(false)}>
          <TwoFactorSetupForm
            onDone={async () => {
              setSettingUpTwoFactor(false)
              await queryClient.invalidateQueries({ queryKey: ['session'] })
            }}
          />
        </DialogShell>
      )}
      {disablingTwoFactor && (
        <DialogShell title="Disable two-factor authentication" onClose={() => setDisablingTwoFactor(false)}>
          <DisableTwoFactorForm
            onDone={async () => {
              setDisablingTwoFactor(false)
              await queryClient.invalidateQueries({ queryKey: ['session'] })
            }}
          />
        </DialogShell>
      )}
    </SettingsPage>
  )
}

function ProfileForm({
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
      const nextEmail = value.email.trim().toLowerCase()
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
          email !== currentEmail.trim().toLowerCase() &&
          hasPassword && (
            <form.Field name="currentPassword">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="profile-current-password">Current password</FieldLabel>
                  <Input
                    id="profile-current-password"
                    type="password"
                    value={field.state.value}
                    maxLength={256}
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

function RemoveMethodForm({ method, onDone }: { method: 'credential' | SocialAuthProvider; onDone: () => void | Promise<void> }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const unlinkAccount = useServerFn(unlinkOwnAccount)
  const label = method === 'credential' ? 'password sign-in' : PROVIDER_NAMES[method]
  return (
    <div className="flex flex-col gap-4">
      <FieldDescription>
        You will no longer be able to sign in with {label}. Your other linked sign-in methods will keep working.
      </FieldDescription>
      <DialogProblem
        title="That sign-in method was not removed"
        hint="You can still sign in with it. At least one other enabled method must stay linked."
        error={error}
      />
      <Button
        type="button"
        variant="destructive"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            await unlinkAccount({ data: { provider: method } })
            await onDone()
          } catch {
            setError('Could not remove this sign-in method. Make sure another enabled method is linked first.')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy && <Spinner />}
        {busy ? 'Removing…' : method === 'credential' ? 'Remove password' : `Unlink ${PROVIDER_NAMES[method]}`}
      </Button>
    </div>
  )
}

function TwoFactorSetupForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const posthog = usePostHog()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [totpURI, setTotpURI] = useState('')
  const [qrCode, setQrCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [verified, setVerified] = useState(false)
  const { copied, copy } = useCopied()

  useEffect(() => {
    if (!totpURI) return
    void QRCode.toDataURL(totpURI, { width: 240, margin: 1 }).then(setQrCode)
  }, [totpURI])

  if (verified) {
    return (
      <div className="flex flex-col gap-4">
        <FieldDescription>
          Save these one-time recovery codes somewhere secure. Each code can be used once if your authenticator is unavailable.
        </FieldDescription>
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
          {backupCodes.map((backupCode) => (
            <span key={backupCode}>{backupCode}</span>
          ))}
        </div>
        <Button type="button" variant="outline" onClick={() => copy(backupCodes.join('\n'))}>
          {copied ? (
            <>
              <Check /> Recovery codes copied
            </>
          ) : (
            'Copy recovery codes'
          )}
        </Button>
        <Button type="button" onClick={() => void onDone()}>
          I saved my recovery codes
        </Button>
      </div>
    )
  }

  if (!totpURI) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError('')
          const { data, error: failed } = await authClient.twoFactor.enable({ password })
          if (failed || !data) setError('Could not start setup. Check your password and try again.')
          else {
            setTotpURI(data.totpURI)
            setBackupCodes(data.backupCodes)
            setPassword('')
          }
          setBusy(false)
        }}
      >
        <Field>
          <FieldLabel htmlFor="two-factor-password">Confirm your password</FieldLabel>
          <Input
            id="two-factor-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <DialogProblem title="Setup could not start" hint="Two-factor authentication is still off. Check your password." error={error} />
        <Button type="submit" disabled={busy || !password}>
          {busy && <Spinner />}
          {busy ? 'Starting…' : 'Continue'}
        </Button>
      </form>
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError('')
        const { error: failed } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') })
        if (failed) setError('That authenticator code is invalid. Check the app and try again.')
        else {
          setVerified(true)
          posthog.capture('two_factor_enabled')
        }
        setBusy(false)
      }}
    >
      <FieldDescription>Scan this QR code in your authenticator app, then enter its current code to finish setup.</FieldDescription>
      {qrCode && <img src={qrCode} alt="Authenticator setup QR code" className="mx-auto size-60 rounded-lg border bg-white p-2" />}
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">Cannot scan the QR code?</summary>
        <code className="mt-2 block break-all rounded bg-muted p-2 text-xs">{totpURI}</code>
      </details>
      <Field>
        <FieldLabel htmlFor="two-factor-setup-code">Authenticator code</FieldLabel>
        <Input
          id="two-factor-setup-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
      </Field>
      <DialogProblem
        title="That code was not accepted"
        hint="Codes expire every 30 seconds, so wait for the next one. Check your phone's clock is set automatically."
        error={error}
      />
      <Button type="submit" disabled={busy || !code.trim()}>
        {busy && <Spinner />}
        {busy ? 'Verifying…' : 'Verify and enable'}
      </Button>
    </form>
  )
}

function DisableTwoFactorForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const posthog = usePostHog()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError('')
        const { error: failed } = await authClient.twoFactor.disable({ password })
        if (failed) setError('Could not disable two-factor authentication. Check your password and try again.')
        else {
          posthog.capture('two_factor_disabled')
          await onDone()
        }
        setBusy(false)
      }}
    >
      <FieldDescription>
        Your account returns to password-only sign-in and your unused recovery codes stop working. You can set up an authenticator again at
        any time.
      </FieldDescription>
      <Field>
        <FieldLabel htmlFor="disable-two-factor-password">Confirm your password</FieldLabel>
        <Input
          id="disable-two-factor-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>
      <DialogProblem
        title="Two-factor authentication is still on"
        hint="Nothing has changed. Check your password and try again."
        error={error}
      />
      <Button type="submit" variant="destructive" disabled={busy || !password}>
        {busy && <Spinner />}
        {busy ? 'Disabling…' : 'Disable two-factor authentication'}
      </Button>
    </form>
  )
}

function MethodRow({
  method,
  name,
  linked,
  available,
  action,
}: {
  method: 'password' | SocialAuthProvider
  name: string
  linked: boolean
  available: boolean
  action?: ReactNode
}) {
  return (
    <SettingRow
      icon={<AuthMethodIcon method={method} />}
      name={name}
      status={{
        label: linked ? 'Linked' : available ? 'Not linked' : 'Unavailable',
        tone: linked ? 'on' : available ? 'ready' : 'off',
      }}
      detail={
        linked
          ? 'You can sign in to STL Quest with this.'
          : available
            ? 'Link this so you have another way into your account.'
            : 'An administrator has turned this sign-in method off for the whole deployment.'
      }
      actions={action}
    />
  )
}

function CreatePasswordForm({ onDone }: { onDone: () => void | Promise<void> }) {
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

function ChangePasswordForm({ onDone }: { onDone: (notice: Notice) => void }) {
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
