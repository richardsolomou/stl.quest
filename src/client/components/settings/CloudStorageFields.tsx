import { CheckCircle2, CircleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import type { PublicCloudConnection } from '../../../core/auth'
import type { StorageConfig } from '../../../core/types'
import { cloudProviderLabel, type CloudProvider } from '../../storageProviders'
import { useI18n } from '../../i18n'
import { CloudProviderIcon } from '../CloudProviderIcon'
import { ProtectedEmail } from '../ProtectedEmail'

type CloudProviderOption = { value: CloudProvider; label: string; available: boolean }

export function CloudStorageFields({
  provider,
  providers,
  connections,
  currentAdapter,
  onboarding,
  superAdmin,
  permissionProvider,
  connectingProvider,
  disconnectingProvider,
  migrationInProgress,
  onProviderChange,
  onSetUp,
  onConnect,
  onDisconnect,
}: {
  provider: CloudProvider
  providers: CloudProviderOption[]
  connections: Record<CloudProvider, PublicCloudConnection>
  currentAdapter: StorageConfig['adapter']
  onboarding: boolean
  superAdmin: boolean
  permissionProvider?: CloudProvider
  connectingProvider?: CloudProvider
  disconnectingProvider?: CloudProvider
  migrationInProgress: boolean
  onProviderChange: (provider: CloudProvider) => void
  onSetUp: (provider: CloudProvider) => void
  onConnect: (provider: CloudProvider) => void
  onDisconnect: (provider: CloudProvider) => void
}) {
  const { storage: t } = useI18n().t
  const connection = connections[provider]
  const label = cloudProviderLabel(provider)
  return (
    <div className="flex flex-col gap-4">
      {!onboarding && (
        <Field>
          <FieldLabel htmlFor="cloud-provider">{t.cloud.provider}</FieldLabel>
          <Select items={providers} value={provider} onValueChange={(value) => onProviderChange(value as CloudProvider)}>
            <SelectTrigger className="w-full" id="cloud-provider">
              <SelectValue>
                <CloudProviderIcon provider={provider} />
                <span>{label}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {providers.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <CloudProviderIcon provider={option.value} />
                  <span>{option.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="flex items-start gap-3">
          <CloudProviderIcon provider={provider} className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
              {connection.connected ? label : t.cloud.connectProvider(label)}
              {connection.connected && (
                <Badge>
                  <CheckCircle2 /> {t.cloud.connected}
                </Badge>
              )}
            </p>
            <div className="mt-1 text-muted-foreground">
              {connection.connected ? (
                <p className="flex flex-wrap items-center gap-x-1">
                  <span>{t.cloud.signedIn(connection.accountName)}</span>
                  {connection.accountEmail ? (
                    <span className="inline-flex">
                      (<ProtectedEmail email={connection.accountEmail} />
                      ).
                    </span>
                  ) : (
                    '.'
                  )}
                </p>
              ) : (
                <p>{t.cloudHelp[provider].intro}</p>
              )}
            </div>
            {!connection.connected && (
              <p className="mt-2 text-muted-foreground">
                {connection.available ? t.cloud.available(label) : superAdmin ? t.cloud.needsSetup(label) : t.cloud.needsAdmin(label)}
              </p>
            )}
          </div>
        </div>
      </div>
      {permissionProvider === provider && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{t.cloud.missingPermissionsTitle(label)}</AlertTitle>
          <AlertDescription>{t.cloud.missingPermissions(label)}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {!connection.available && superAdmin && (
          <Button type="button" onClick={() => onSetUp(provider)}>
            {t.cloud.setUpApp(label)}
          </Button>
        )}
        <Button
          type="button"
          variant={connection.connected || !connection.available ? 'outline' : 'default'}
          // Stay clickable while the redirect is in flight, so a repeat click retries instead of landing on a dead control.
          disabled={!connection.available}
          onClick={() => onConnect(provider)}
        >
          {connectingProvider === provider && <Spinner />}
          {connectingProvider === provider
            ? t.cloud.opening(label)
            : (connection.connected ? t.cloud.reconnectMine : t.cloud.connectMine)(label)}
        </Button>
        {connection.connected && currentAdapter !== provider && (
          <Button
            type="button"
            variant="outline"
            disabled={disconnectingProvider === provider || migrationInProgress}
            onClick={() => onDisconnect(provider)}
          >
            {disconnectingProvider === provider && <Spinner />}
            {disconnectingProvider === provider ? t.cloud.disconnecting : t.cloud.disconnect}
          </Button>
        )}
      </div>
    </div>
  )
}
