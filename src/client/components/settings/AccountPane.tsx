import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SOCIAL_AUTH_PROVIDERS, SOCIAL_AUTH_PROVIDER_NAMES, type SocialAuthProvider } from '../../../core/auth'
import { storagePlans, type StoragePlan } from '../../../core/plans'
import type { Identity } from '../../../core/types'
import { authClient } from '../../authClient'
import { accountMethodsQuery, sessionQuery } from '../../queries'
import { retryQueries } from '../../queryState'
import { AuthMethodIcon } from '../AuthMethodIcon'
import { DialogShell } from '../DialogShell'
import { QueryState } from '../QueryState'
import { SettingNotice, type Notice } from '../SettingNotice'
import { SettingRow } from '../SettingRow'
import { ProtectedEmail } from '../ProtectedEmail'
import { UserAvatar } from '../UserAvatar'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { DisableTwoFactorForm, TwoFactorSetupForm } from './AccountTwoFactorForms'
import { ChangePasswordForm, CreatePasswordForm } from './AccountPasswordForms'
import { AccountProfileForm } from './AccountProfileForm'
import { MethodRow, RemoveMethodForm } from './AccountMethodForms'

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
      {session.billing?.available && <BillingSection plan={session.billing.plan} />}
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
          <AccountProfileForm
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

function BillingSection({ plan }: { plan: StoragePlan }) {
  const [pending, setPending] = useState<StoragePlan | 'portal'>()
  const [error, setError] = useState<string>()
  const paid = plan !== 'free'

  const subscribe = async (nextPlan: Exclude<StoragePlan, 'free'>) => {
    setPending(nextPlan)
    setError(undefined)
    const returnUrl = `${window.location.origin}/account`
    const result = await authClient.subscription.upgrade({ plan: nextPlan, successUrl: returnUrl, cancelUrl: returnUrl })
    setPending(undefined)
    if (result.error) setError(result.error.message ?? 'Could not open Stripe Checkout.')
  }

  const manage = async () => {
    setPending('portal')
    setError(undefined)
    const result = await authClient.subscription.billingPortal({ returnUrl: `${window.location.origin}/account` })
    setPending(undefined)
    if (result.error) setError(result.error.message ?? 'Could not open the billing portal.')
  }

  return (
    <SettingsSection
      title="Plan"
      description={`Your ${storagePlans[plan].name} plan includes ${formatStorage(storagePlans[plan].quotaBytes)} of managed storage.`}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(storagePlans) as StoragePlan[]).map((candidate) => {
          const details = storagePlans[candidate]
          const current = candidate === plan
          const upgrade = details.monthlyPrice > storagePlans[plan].monthlyPrice
          return (
            <div key={candidate} className="flex flex-col gap-3 rounded-lg border p-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">{details.name}</h3>
                  {current && <span className="text-xs font-medium text-muted-foreground">Current</span>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{formatStorage(details.quotaBytes)} managed storage</p>
                <p className="mt-2 text-lg font-semibold">{details.monthlyPrice ? `$${details.monthlyPrice}/month` : 'Free'}</p>
              </div>
              {candidate !== 'free' && upgrade && (
                <Button
                  type="button"
                  size="sm"
                  className="mt-auto"
                  disabled={pending !== undefined}
                  onClick={() => void subscribe(candidate)}
                >
                  {pending === candidate ? 'Opening Stripe…' : paid ? `Switch to ${details.name}` : `Choose ${details.name}`}
                </Button>
              )}
            </div>
          )
        })}
      </div>
      {paid && (
        <Button type="button" variant="outline" disabled={pending !== undefined} onClick={() => void manage()}>
          {pending === 'portal' ? 'Opening Stripe…' : 'Manage billing'}
        </Button>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </SettingsSection>
  )
}

function formatStorage(bytes: number) {
  return `${bytes / 1_000_000_000} GB`
}
