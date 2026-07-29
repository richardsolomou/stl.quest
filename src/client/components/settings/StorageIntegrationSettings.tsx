import { Button } from '@/components/ui/button'
import { CLOUD_STORAGE_PROVIDERS, type CloudStorageProvider, type PublicIntegrationConfig } from '../../../core/auth'
import { CLOUD_PROVIDER_HELP, cloudProviderLabel } from '../../storageProviders'
import { CloudProviderIcon } from '../CloudProviderIcon'
import { SettingRow } from '../SettingRow'
import { SettingsSection } from './SettingsLayout'

export function CloudStorageSettings({
  data,
  onConfigure,
}: {
  data: PublicIntegrationConfig
  onConfigure: (provider: CloudStorageProvider) => void
}) {
  return (
    <SettingsSection
      title="Cloud storage"
      description="Register one app per provider so every workspace can connect its own account. Each workspace owner signs in themselves, and their models stay in their own account."
    >
      <div className="flex flex-col gap-2">
        {CLOUD_STORAGE_PROVIDERS.map((provider) => {
          const config = data.cloudStorage[provider]
          return (
            <SettingRow
              key={provider}
              icon={<CloudProviderIcon provider={provider} />}
              name={cloudProviderLabel(provider)}
              status={{ label: config.configured ? 'Available to workspaces' : 'Not set up', tone: config.configured ? 'ready' : 'off' }}
              detail={CLOUD_PROVIDER_HELP[provider].intro}
              actions={
                <Button type="button" variant="outline" size="sm" onClick={() => onConfigure(provider)}>
                  {config.configured ? 'Edit app' : 'Set up app'}
                </Button>
              }
            />
          )
        })}
      </div>
    </SettingsSection>
  )
}
