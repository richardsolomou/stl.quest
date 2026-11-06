import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { CLOUD_STORAGE_PROVIDERS, type CloudStorageProvider, type PublicIntegrationConfig } from '../../../core/auth'
import { cloudProviderLabel } from '../../storageProviders'
import { useI18n } from '../../i18n'
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
  const t = useI18n().t.storage
  const queryClient = useQueryClient()
  const setEnabled = useMutation({
    mutationFn: useServerFn(setCloudStorageProviderEnabled),
    onSuccess: () => invalidateQueries(queryClient, 'integrations', 'cloud-connections'),
  })
  return (
    <SettingsSection title={t.integrations.title} description={t.integrations.description}>
      <div className="flex flex-col gap-2">
        {CLOUD_STORAGE_PROVIDERS.map((provider) => {
          const config = data.cloudStorage[provider]
          const label = cloudProviderLabel(provider)
          return (
            <SettingRow
              key={provider}
              icon={<CloudProviderIcon provider={provider} />}
              name={label}
              status={{
                label: config.enabled ? t.integrations.enabled : config.configured ? t.integrations.disabled : t.integrations.notSetUp,
                tone: config.enabled ? 'ready' : 'off',
              }}
              detail={t.cloudHelp[provider].intro}
              actions={
                <div className="flex items-center gap-3">
                  {config.configured && (
                    <Switch
                      aria-label={(config.enabled ? t.integrations.disable : t.integrations.enable)(label)}
                      checked={config.enabled}
                      disabled={setEnabled.isPending}
                      onCheckedChange={(enabled) => setEnabled.mutate({ data: { provider, enabled } })}
                    />
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => onConfigure(provider)}>
                    {config.configured ? t.integrations.editApp : t.integrations.setUpApp}
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
