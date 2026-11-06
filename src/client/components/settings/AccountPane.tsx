import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SOCIAL_AUTH_PROVIDERS, socialProviderName, type SocialAuthProvider } from '../../../core/auth'
import type { Identity } from '../../../core/types'
import { authClient } from '../../authClient'
import { useI18n } from '../../i18n'
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
import { AccountAppearance } from './AccountAppearance'
import { AccountNotifications } from './AccountNotifications'
import { AccountLanguage } from './AccountLanguage'
import { MethodRow, RemoveMethodForm } from './AccountMethodForms'

export function AccountPane({ me }: { me: Identity }) {
  const { t } = useI18n()
  const { pane, twoFactor, methods: methodCopy, password, profile } = t.account
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
        <SettingsHeader title={pane.title} description={pane.description} />
        <QueryState
          loading={sessionResult.isPending || methodsResult.isPending}
          error={sessionResult.error ?? methodsResult.error}
          loadingLabel={pane.loading}
          errorTitle={pane.loadFailed}
          onRetry={() => void retryQueries(sessionResult.refetch, methodsResult.refetch)}
        />
      </SettingsPage>
    )
  }
  return (
    <SettingsPage>
      <SettingsHeader title={pane.title} description={pane.description} />
      <SettingNotice notice={notice} />
      <SettingsSection title={pane.profileTitle} description={pane.profileDescription}>
        <div className="flex items-center gap-3">
          <UserAvatar name={me.name} image={me.image} size="lg" />
          <div>
            <h3 className="ph-no-capture font-medium">{me.name}</h3>
            <ProtectedEmail email={me.email} className="block text-sm text-muted-foreground" />
          </div>
          <Button type="button" variant="outline" className="ml-auto" onClick={() => setEditingProfile(true)}>
            {pane.editProfile}
          </Button>
        </div>
      </SettingsSection>
      <AccountAppearance />
      <AccountLanguage preference={me.locale} />
      {me.workspaceSlug && (
        <AccountNotifications
          workspaceSlug={me.workspaceSlug}
          workspaceName={session.workspace?.name ?? pane.thisWorkspace}
          emailConfigured={session.email.workspaceConfigured}
        />
      )}
      <SettingsSection title={twoFactor.title} description={twoFactor.description}>
        <SettingRow
          icon={<ShieldCheck />}
          name={twoFactor.app}
          status={{
            label: me.twoFactorEnabled ? twoFactor.enabled : hasPassword ? twoFactor.notSetUp : twoFactor.needsPassword,
            tone: me.twoFactorEnabled ? 'on' : hasPassword ? 'ready' : 'off',
          }}
          detail={me.twoFactorEnabled ? twoFactor.enabledDetail : hasPassword ? twoFactor.readyDetail : twoFactor.needsPasswordDetail}
          actions={
            me.twoFactorEnabled ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setDisablingTwoFactor(true)}>
                {twoFactor.turnOff}
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" disabled={!hasPassword} onClick={() => setSettingUpTwoFactor(true)}>
                {twoFactor.setUp}
              </Button>
            )
          }
        />
      </SettingsSection>
      <SettingsSection title={methodCopy.title} description={methodCopy.description}>
        <div className="flex flex-col gap-2">
          <MethodRow
            method="password"
            name={methodCopy.password}
            linked={hasPassword}
            available={methods?.passwordAvailable ?? false}
            action={
              hasPassword && session?.auth.password ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setChangingPassword(true)}>
                    {methodCopy.changePassword}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={usableLinkedMethods < 2}
                    onClick={() => setRemovingMethod('credential')}
                  >
                    {methodCopy.removePassword}
                  </Button>
                </div>
              ) : methods?.passwordAvailable ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setCreatingPassword(true)}>
                  {methodCopy.createPassword}
                </Button>
              ) : undefined
            }
          />
          {SOCIAL_AUTH_PROVIDERS.filter((provider) => linked.has(provider) || methods.availableProviders.includes(provider)).map(
            (provider) => (
              <MethodRow
                key={provider}
                method={provider}
                name={socialProviderName(provider, methods.oidcName)}
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
                      {methodCopy.unlink(socialProviderName(provider, methods.oidcName))}
                    </Button>
                  ) : methods.availableProviders.includes(provider) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void authClient.linkSocial({ provider, callbackURL: '/account', errorCallbackURL: '/account' })}
                    >
                      <AuthMethodIcon method={provider} /> {methodCopy.link(socialProviderName(provider, methods.oidcName))}
                    </Button>
                  ) : undefined
                }
              />
            ),
          )}
        </div>
      </SettingsSection>
      {editingProfile && (
        <DialogShell title={profile.title} onClose={() => setEditingProfile(false)}>
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
          title={
            removingMethod === 'credential'
              ? methodCopy.removePasswordTitle
              : methodCopy.unlink(socialProviderName(removingMethod, methods.oidcName))
          }
          onClose={() => setRemovingMethod(undefined)}
        >
          <RemoveMethodForm
            method={removingMethod}
            oidcName={methods.oidcName}
            onDone={async () => {
              setRemovingMethod(undefined)
              await queryClient.invalidateQueries({ queryKey: ['account-methods'] })
            }}
          />
        </DialogShell>
      )}
      {creatingPassword && (
        <DialogShell title={password.createTitle} description={password.createDescription} onClose={() => setCreatingPassword(false)}>
          <CreatePasswordForm
            onDone={async () => {
              setCreatingPassword(false)
              await queryClient.invalidateQueries({ queryKey: ['account-methods'] })
            }}
          />
        </DialogShell>
      )}
      {changingPassword && (
        <DialogShell title={password.changeTitle} onClose={() => setChangingPassword(false)}>
          <ChangePasswordForm
            onDone={(changed) => {
              setChangingPassword(false)
              setNotice(changed)
            }}
          />
        </DialogShell>
      )}
      {settingUpTwoFactor && (
        <DialogShell title={twoFactor.setUpTitle} onClose={() => setSettingUpTwoFactor(false)}>
          <TwoFactorSetupForm
            onDone={async () => {
              setSettingUpTwoFactor(false)
              await queryClient.invalidateQueries({ queryKey: ['session'] })
            }}
          />
        </DialogShell>
      )}
      {disablingTwoFactor && (
        <DialogShell title={twoFactor.disableTitle} onClose={() => setDisablingTwoFactor(false)}>
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
