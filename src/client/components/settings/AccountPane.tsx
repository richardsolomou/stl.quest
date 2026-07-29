import { useState, type ReactNode } from 'react'
import { useForm } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { SOCIAL_AUTH_PROVIDERS, SOCIAL_AUTH_PROVIDER_NAMES, type SocialAuthProvider } from '../../../core/auth'
import type { Identity } from '../../../core/types'
import { changeOwnEmail, unlinkOwnAccount } from '../../../server/fns'
import { authClient } from '../../authClient'
import { accountMethodsQuery, sessionQuery } from '../../queries'
import { retryQueries } from '../../queryState'
import { AuthMethodIcon } from '../AuthMethodIcon'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { QueryState } from '../QueryState'
import { SettingNotice, type Notice } from '../SettingNotice'
import { SettingRow } from '../SettingRow'
import { ProtectedEmail } from '../ProtectedEmail'
import { UserAvatar } from '../UserAvatar'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { DisableTwoFactorForm, TwoFactorSetupForm } from './AccountTwoFactorForms'
import { ChangePasswordForm, CreatePasswordForm } from './AccountPasswordForms'

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
                name={SOCIAL_AUTH_PROVIDER_NAMES[provider]}
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
                      Unlink {SOCIAL_AUTH_PROVIDER_NAMES[provider]}
                    </Button>
                  ) : methods.availableProviders.includes(provider) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void authClient.linkSocial({ provider, callbackURL: '/account', errorCallbackURL: '/account' })}
                    >
                      <AuthMethodIcon method={provider} /> Link {SOCIAL_AUTH_PROVIDER_NAMES[provider]}
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
          title={removingMethod === 'credential' ? 'Remove password sign-in' : `Unlink ${SOCIAL_AUTH_PROVIDER_NAMES[removingMethod]}`}
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
  const label = method === 'credential' ? 'password sign-in' : SOCIAL_AUTH_PROVIDER_NAMES[method]
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
        {busy ? 'Removing…' : method === 'credential' ? 'Remove password' : `Unlink ${SOCIAL_AUTH_PROVIDER_NAMES[method]}`}
      </Button>
    </div>
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
