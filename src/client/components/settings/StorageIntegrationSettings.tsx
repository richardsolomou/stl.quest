import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { CLOUD_STORAGE_PROVIDERS, type CloudStorageProvider, type PublicIntegrationConfig } from '../../../core/auth'
import { CLOUD_PROVIDER_HELP, cloudProviderLabel } from '../../storageProviders'
import { CloudProviderIcon } from '../CloudProviderIcon'
import { SettingRow } from '../SettingRow'
import { setCloudStorageProviderEnabled } from '../../../server/fns'
import { invalidateQueries } from '../../queryState'
import { SettingsSection } from './SettingsLayout'

export function CloudStorageSettings({
  data,
  onConfigure,
}: {
  data: PublicIntegrationConfig
  onConfigure: (provider: CloudStorageProvider) => void
}) {
  const queryClient = useQueryClient()
  const setEnabled = useMutation({
    mutationFn: useServerFn(setCloudStorageProviderEnabled),
    onSuccess: () => invalidateQueries(queryClient, 'integrations', 'cloud-connections'),
  })
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
              status={{
                label: config.enabled ? 'Available to workspaces' : config.configured ? 'Disabled' : 'Not set up',
                tone: config.enabled ? 'ready' : 'off',
              }}
              detail={CLOUD_PROVIDER_HELP[provider].intro}
              actions={
                <div className="flex items-center gap-3">
                  {config.configured && (
                    <Switch
                      aria-label={`${config.enabled ? 'Disable' : 'Enable'} ${cloudProviderLabel(provider)}`}
                      checked={config.enabled}
                      disabled={setEnabled.isPending}
                      onCheckedChange={(enabled) => setEnabled.mutate({ data: { provider, enabled } })}
                    />
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => onConfigure(provider)}>
                    {config.configured ? 'Edit app' : 'Set up app'}
                  </Button>
                </div>
              }
            />
          )
        })}
      </div>
    </SettingsSection>
  )
}
