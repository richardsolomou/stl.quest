import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { HardDrive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { CLOUD_STORAGE_PROVIDERS, type CloudStorageProvider, type PublicIntegrationConfig } from '../../../core/auth'
import { updateLocalStorageAvailability } from '../../../server/fns'
import { invalidateQueries } from '../../queryState'
import { CLOUD_PROVIDER_HELP, cloudProviderLabel } from '../../storageProviders'
import { CloudProviderIcon } from '../CloudProviderIcon'
import { SettingRow } from '../SettingRow'
import { SettingsSection } from './SettingsLayout'

export function StorageAvailabilitySettings({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: useServerFn(updateLocalStorageAvailability),
    onSuccess: () => invalidateQueries(queryClient, 'integrations', 'session'),
  })
  return (
    <SettingsSection title="Storage providers" description="Choose which server-managed storage providers workspace admins can configure.">
      <SettingRow
        icon={<HardDrive />}
        name="Local folders"
        status={{ label: enabled ? 'Available to workspaces' : 'Disabled', tone: enabled ? 'on' : 'off' }}
        detail="Allow workspace admins to store models in folders writable by this server. Existing files remain available for migration when disabled."
        problem={mutation.error?.message}
        actions={
          <Switch
            aria-label="Enable local folder storage"
            checked={enabled}
            disabled={mutation.isPending}
            onCheckedChange={(next) => mutation.mutate({ data: { enabled: next } })}
          />
        }
      />
    </SettingsSection>
  )
}

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
