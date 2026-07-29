import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CloudStorageProvider, SocialAuthProvider } from '../../../core/auth'
import { integrationsQuery } from '../../queries'
import { QueryState } from '../QueryState'
import { CloudStorageAppDialog } from './CloudStorageAppDialog'
import { AuthenticationSettings, ProviderDialog } from './AuthenticationIntegrationSettings'
import { SettingsHeader, SettingsPage } from './SettingsLayout'
import { SmtpDialog, SmtpSettings } from './SmtpIntegrationSettings'
import { CloudStorageSettings, StorageAvailabilitySettings } from './StorageIntegrationSettings'

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
      {provider && (
        <ProviderDialog provider={provider} current={data.providers[provider]} origin={data.origin} onDone={() => setProvider(null)} />
      )}
      {cloudProvider && (
        <CloudStorageAppDialog provider={cloudProvider} current={data.cloudStorage[cloudProvider]} onDone={() => setCloudProvider(null)} />
      )}
      {smtpOpen && <SmtpDialog current={data} onDone={() => setSmtpOpen(false)} />}
    </SettingsPage>
  )
}
