import { CheckCircle2, CircleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import type { PublicCloudConnection } from '../../../core/auth'
import type { StorageConfig } from '../../../core/types'
import { CLOUD_PROVIDER_HELP, cloudProviderLabel, type CloudProvider } from '../../storageProviders'
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
  const connection = connections[provider]
  return (
    <div className="flex flex-col gap-4">
      {!onboarding && (
        <Field>
          <FieldLabel htmlFor="cloud-provider">Cloud provider</FieldLabel>
          <Select items={providers} value={provider} onValueChange={(value) => onProviderChange(value as CloudProvider)}>
            <SelectTrigger className="w-full" id="cloud-provider">
              <SelectValue>
                <CloudProviderIcon provider={provider} />
                <span>{cloudProviderLabel(provider)}</span>
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
              {connection.connected ? cloudProviderLabel(provider) : `Connect ${cloudProviderLabel(provider)}`}
              {connection.connected && (
                <Badge>
                  <CheckCircle2 /> Connected
                </Badge>
              )}
            </p>
            <div className="mt-1 text-muted-foreground">
              {connection.connected ? (
                <p className="flex flex-wrap items-center gap-x-1">
                  <span>Signed in{connection.accountName ? ` as ${connection.accountName}` : ''}</span>
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
                <p>{CLOUD_PROVIDER_HELP[provider].intro}</p>
              )}
            </div>
            {!connection.connected && (
              <p className="mt-2 text-muted-foreground">
                {connection.available
                  ? `Sign in below and STL Quest writes this workspace's models into your own ${cloudProviderLabel(provider)}.`
                  : superAdmin
                    ? `${cloudProviderLabel(provider)} needs a one-time setup for this deployment. Do it once and every workspace, including this one, can connect its own account.`
                    : `An administrator has to set ${cloudProviderLabel(provider)} up for this deployment before it can be connected.`}
              </p>
            )}
          </div>
        </div>
      </div>
      {permissionProvider === provider && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{cloudProviderLabel(provider)} did not grant the access STL Quest needs</AlertTitle>
          <AlertDescription>
            The deployment’s {cloudProviderLabel(provider)} app is missing permissions. An administrator has to update it in Integrations,
            then you can connect again.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {!connection.available && superAdmin && (
          <Button type="button" onClick={() => onSetUp(provider)}>
            Set up the {cloudProviderLabel(provider)} app
          </Button>
        )}
        <Button
          type="button"
          variant={connection.connected || !connection.available ? 'outline' : 'default'}
          disabled={connectingProvider === provider || !connection.available}
          onClick={() => onConnect(provider)}
        >
          {connectingProvider === provider && <Spinner />}
          {connectingProvider === provider
            ? `Opening ${cloudProviderLabel(provider)}…`
            : `${connection.connected ? 'Reconnect' : 'Connect'} my ${cloudProviderLabel(provider)}`}
        </Button>
        {connection.connected && currentAdapter !== provider && (
          <Button
            type="button"
            variant="outline"
            disabled={disconnectingProvider === provider || migrationInProgress}
            onClick={() => onDisconnect(provider)}
          >
            {disconnectingProvider === provider && <Spinner />}
            {disconnectingProvider === provider ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        )}
      </div>
    </div>
  )
}
