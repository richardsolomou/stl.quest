import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import type { CloudStorageProvider, PublicIntegrationConfig, SocialAuthProvider } from '../../../core/auth'
import { DialogProblem } from '../DialogProblem'
import { CloudStorageAppDialog } from './CloudStorageAppDialog'
import { saveSocialProvider, updatePasswordAuth, updateSocialProviderEnabled } from '../../../server/fns'
import { authClient } from '../../authClient'
import { integrationsQuery } from '../../queries'
import { invalidateQueries } from '../../queryState'
import { SOCIAL_PROVIDER_OPTIONS, SOCIAL_PROVIDER_SETTINGS } from '../../socialProviderSettings'
import { QueryState } from '../QueryState'
import { DialogShell } from '../DialogShell'
import { SettingRow } from '../SettingRow'
import { AuthMethodIcon } from '../AuthMethodIcon'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { SocialProviderSetupInstructions } from './SocialProviderSetupInstructions'
import { SmtpDialog, SmtpSettings } from './SmtpIntegrationSettings'
import { CloudStorageSettings, StorageAvailabilitySettings } from './StorageIntegrationSettings'

const refreshIntegrationSettings = (queryClient: ReturnType<typeof useQueryClient>) =>
  invalidateQueries(queryClient, 'integrations', 'session')

export function IntegrationsPane() {
  const query = useQuery(integrationsQuery())
  const data = query.data
  const [provider, setProvider] = useState<SocialAuthProvider | null>(null)
  const [cloudProvider, setCloudProvider] = useState<CloudStorageProvider | null>(null)
  const [smtpOpen, setSmtpOpen] = useState(false)
  if (!data) {
    return (
      <SettingsPage>
        <SettingsHeader title="Integrations" description="Deployment-wide sign-in methods, cloud storage apps, and outbound email." />
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel="Loading integration settings…"
          errorTitle="Could not load integration settings"
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    )
  }
  return (
    <SettingsPage>
      <SettingsHeader
        title="Integrations"
        description="Deployment-wide sign-in methods, cloud storage apps, and outbound email. Workspace membership is always invite-only."
      />
      <AuthenticationSettings data={data} onConfigure={setProvider} />
      <StorageAvailabilitySettings enabled={data.localStorageEnabled} />
      <CloudStorageSettings data={data} onConfigure={setCloudProvider} />
      <SmtpSettings data={data} onConfigure={() => setSmtpOpen(true)} />
      {provider && <ProviderDialog provider={provider} current={data.providers[provider]} onDone={() => setProvider(null)} />}
      {cloudProvider && (
        <CloudStorageAppDialog provider={cloudProvider} current={data.cloudStorage[cloudProvider]} onDone={() => setCloudProvider(null)} />
      )}
      {smtpOpen && <SmtpDialog current={data} onDone={() => setSmtpOpen(false)} />}
    </SettingsPage>
  )
}

function AuthenticationSettings({
  data,
  onConfigure,
}: {
  data: PublicIntegrationConfig
  onConfigure: (provider: SocialAuthProvider) => void
}) {
  const queryClient = useQueryClient()
  const passwordMutation = useMutation({
    mutationFn: useServerFn(updatePasswordAuth),
    onSuccess: () => refreshIntegrationSettings(queryClient),
  })
  return (
    <SettingsSection
      title="Sign-in methods"
      description="Password, Google, and Discord can be enabled together. Joining an existing workspace always requires an invite."
    >
      <div className="flex flex-col gap-2">
        <SettingRow
          icon={<AuthMethodIcon method="password" />}
          name="Password"
          status={{ label: data.passwordEnabled ? 'Enabled' : 'Disabled', tone: data.passwordEnabled ? 'on' : 'off' }}
          detail={
            data.passwordForcedByRecovery
              ? 'Built-in email and password sign-in. Recovery mode is forcing this on.'
              : 'Built-in email and password sign-in.'
          }
          problem={passwordMutation.error?.message}
          actions={
            <Switch
              aria-label="Enable password authentication"
              checked={data.passwordEnabled}
              disabled={data.passwordSource === 'environment' || passwordMutation.isPending}
              onCheckedChange={(enabled) => passwordMutation.mutate({ data: { enabled } })}
            />
          }
        />
        {SOCIAL_PROVIDER_OPTIONS.map((item) => (
          <ProviderRow key={item.id} item={item} config={data.providers[item.id]} onConfigure={() => onConfigure(item.id)} />
        ))}
      </div>
    </SettingsSection>
  )
}

function ProviderRow({
  item,
  config,
  onConfigure,
}: {
  item: (typeof SOCIAL_PROVIDER_OPTIONS)[number]
  config: PublicIntegrationConfig['providers'][SocialAuthProvider]
  onConfigure: () => void
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: useServerFn(updateSocialProviderEnabled),
    onSuccess: () => refreshIntegrationSettings(queryClient),
  })
  const status = config.enabled
    ? { label: 'Enabled', tone: 'on' as const }
    : config.linked
      ? { label: 'Tested, not enabled', tone: 'ready' as const }
      : config.configured
        ? { label: 'Needs testing', tone: 'ready' as const }
        : { label: 'Not set up', tone: 'off' as const }
  return (
    <SettingRow
      icon={<AuthMethodIcon method={item.id} />}
      name={item.name}
      status={status}
      detail={
        config.configured && !config.linked
          ? `${item.description} Sign in once with ${item.name} to prove the credentials work, then enable it.`
          : item.description
      }
      problem={mutation.error?.message}
      actions={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onConfigure}>
            {config.configured ? 'Edit app' : 'Set up app'}
          </Button>
          {config.configured && !config.linked && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void authClient.linkSocial({
                  provider: item.id,
                  callbackURL: '/admin/integrations',
                  errorCallbackURL: '/admin/integrations',
                })
              }
            >
              Test sign-in
            </Button>
          )}
          <Switch
            aria-label={`Enable ${item.name} authentication`}
            checked={config.enabled}
            disabled={!config.configured || !config.linked || config.source === 'environment' || mutation.isPending}
            onCheckedChange={(enabled) => mutation.mutate({ data: { provider: item.id, enabled } })}
          />
        </>
      }
    />
  )
}

function ProviderDialog({
  provider,
  current,
  onDone,
}: {
  provider: SocialAuthProvider
  current: PublicIntegrationConfig['providers'][SocialAuthProvider]
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [clientId, setClientId] = useState(current.clientId)
  const [clientSecret, setClientSecret] = useState('')
  const mutation = useMutation({
    mutationFn: useServerFn(saveSocialProvider),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations'] })
      onDone()
    },
  })
  const providerSettings = SOCIAL_PROVIDER_SETTINGS[provider]
  const name = providerSettings.name
  const origin = window.location.origin
  const callbackUrl = `${origin}/api/auth/callback/${provider}`
  return (
    <DialogShell open title={`Configure ${name}`} className="sm:max-w-[640px]" onClose={onDone}>
      <div className="space-y-5 pr-1">
        <SocialProviderSetupInstructions provider={provider} origin={origin} callbackUrl={callbackUrl} />
        <FieldSet>
          <FieldLegend>App credentials</FieldLegend>
          <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
            <Field>
              <FieldLabel htmlFor="provider-client-id">Client ID</FieldLabel>
              <Input id="provider-client-id" value={clientId} autoComplete="off" onChange={(event) => setClientId(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-client-secret">Client secret</FieldLabel>
              <Input
                id="provider-client-secret"
                type="password"
                value={clientSecret}
                autoComplete="off"
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder={current.secretConfigured ? 'Leave blank to keep the current secret' : ''}
              />
            </Field>
          </div>
          <FieldDescription>After saving, sign in once with {name} to prove the credentials work. Then enable it.</FieldDescription>
        </FieldSet>
        <DialogProblem
          title={`${name} credentials were not saved`}
          hint={`Check that the client ID and secret match the OAuth client in ${providerSettings.consoleName}.`}
          error={mutation.error?.message}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={!clientId || mutation.isPending}
            onClick={() => mutation.mutate({ data: { provider, clientId, clientSecret } })}
          >
            {mutation.isPending && <Spinner />}
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
