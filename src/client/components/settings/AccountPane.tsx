import { useEffect, useState, type ReactNode } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import QRCode from 'qrcode'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
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
import { DialogShell } from '../DialogShell'
import { QueryState } from '../QueryState'
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
  const [editingProfile, setEditingProfile] = useState(false)
  const [removingMethod, setRemovingMethod] = useState<'credential' | SocialAuthProvider>()
  const [settingUpTwoFactor, setSettingUpTwoFactor] = useState(false)
  const [disablingTwoFactor, setDisablingTwoFactor] = useState(false)
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
      <SettingsSection title="Profile" description="Choose how your account is identified in STL Quest.">
        <div className="flex items-center gap-3">
          <UserAvatar name={me.name} image={me.image} size="lg" />
          <div>
            <h3 className="font-medium">{me.name}</h3>
            <p className="text-sm text-muted-foreground">{me.email}</p>
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              Authenticator app
              <Badge variant={me.twoFactorEnabled ? 'default' : 'secondary'}>{me.twoFactorEnabled ? 'Enabled' : 'Optional'}</Badge>
            </CardTitle>
            <CardDescription>
              {me.twoFactorEnabled
                ? 'Your password sign-in is protected with a second factor.'
                : hasPassword
                  ? 'Add a time-based code from apps such as 1Password, Authy, or Google Authenticator.'
                  : 'Create a password sign-in method before enabling two-factor authentication.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {me.twoFactorEnabled ? (
              <Button type="button" variant="outline" onClick={() => setDisablingTwoFactor(true)}>
                Disable two-factor authentication
              </Button>
            ) : (
              <Button type="button" disabled={!hasPassword} onClick={() => setSettingUpTwoFactor(true)}>
                Set up authenticator app
              </Button>
            )}
          </CardContent>
        </Card>
      </SettingsSection>
      <SettingsSection title="Sign-in methods" description="Link multiple methods so you always have another way into your account.">
        <div className="grid gap-3 sm:grid-cols-3">
          <MethodCard
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
                <CreatePasswordForm
                  onDone={async () => {
                    await queryClient.invalidateQueries({ queryKey: ['account-methods'] })
                  }}
                />
              ) : undefined
            }
          />
          {SOCIAL_AUTH_PROVIDERS.filter((provider) => linked.has(provider) || methods.availableProviders.includes(provider)).map(
            (provider) => (
              <MethodCard
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
            onDone={async () => {
              setEditingProfile(false)
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
      {changingPassword && (
        <DialogShell title="Change password" onClose={() => setChangingPassword(false)}>
          <ChangePasswordForm onDone={() => setChangingPassword(false)} />
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
  onDone: () => void | Promise<void>
}) {
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
      toast.success(
        nextEmail === email ? 'Profile updated.' : 'Email change requested. Check your new address if verification is required.',
      )
      await onDone()
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
      <FieldError>{error}</FieldError>
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
      <FieldError>{error}</FieldError>
      <Button
        type="button"
        variant="destructive"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            await unlinkAccount({ data: { provider: method } })
            toast.success(`${method === 'credential' ? 'Password sign-in removed' : `${PROVIDER_NAMES[method]} unlinked`}.`)
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
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [totpURI, setTotpURI] = useState('')
  const [qrCode, setQrCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [verified, setVerified] = useState(false)

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
        <Button
          type="button"
          variant="outline"
          onClick={() => void navigator.clipboard.writeText(backupCodes.join('\n')).then(() => toast.success('Recovery codes copied.'))}
        >
          Copy recovery codes
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
        <FieldError>{error}</FieldError>
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
          toast.success('Two-factor authentication enabled.')
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
      <FieldError>{error}</FieldError>
      <Button type="submit" disabled={busy || !code.trim()}>
        {busy && <Spinner />}
        {busy ? 'Verifying…' : 'Verify and enable'}
      </Button>
    </form>
  )
}

function DisableTwoFactorForm({ onDone }: { onDone: () => void | Promise<void> }) {
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
          toast.success('Two-factor authentication disabled.')
          await onDone()
        }
        setBusy(false)
      }}
    >
      <FieldDescription>Your account will return to password-only sign-in.</FieldDescription>
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
      <FieldError>{error}</FieldError>
      <Button type="submit" variant="destructive" disabled={busy || !password}>
        {busy && <Spinner />}
        {busy ? 'Disabling…' : 'Disable two-factor authentication'}
      </Button>
    </form>
  )
}

function MethodCard({
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
    <Card data-auth-method={method}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AuthMethodIcon method={method} /> {name}
        </CardTitle>
        <CardDescription>
          {linked ? 'Linked to this account.' : available ? 'Available to link.' : 'Disabled by the admin.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        <Badge variant={linked ? 'default' : 'secondary'}>{linked ? 'Linked' : available ? 'Not linked' : 'Unavailable'}</Badge>
        {action}
      </CardContent>
    </Card>
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
      toast.success('Password sign-in enabled.')
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
      <FieldError>{mutation.error?.message}</FieldError>
    </div>
  )
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
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
        toast.success('Password changed.')
        onDone()
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
      <FieldDescription>Change the password used with {`your account email`}.</FieldDescription>
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
      <FieldError>{error}</FieldError>
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
