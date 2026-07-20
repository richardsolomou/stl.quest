import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { ExternalLink } from 'lucide-react'
import { SiDropbox, SiGoogledrive } from 'react-icons/si'
import { TbBrandOnedrive } from 'react-icons/tb'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import type { PublicCloudConnection } from '../../../core/auth'
import type { PublicStorageMigration, StorageConfig } from '../../../core/types'
import {
  acknowledgeStorageMigration,
  beginCloudConnection,
  cancelStorageMigration,
  removeCloudConnection,
  retryStorageMigration,
  startStorageMigration,
  updateStorageSettings,
} from '../../../server/fns'
import { cloudConnectionsQuery, sessionQuery, storageMigrationQuery, storageQuery } from '../../queries'
import { retryQueries } from '../../queryState'
import {
  cloudflareAccountId,
  inferS3Provider,
  S3_PROVIDER_HELP,
  S3_PROVIDERS,
  s3Endpoint,
  s3ProviderLabel,
  type S3Provider,
} from '../../storageProviders'
import { ConfirmDialog } from '../ConfirmDialog'
import { QueryState } from '../QueryState'
import { ServerFolderPicker } from '../ServerFolderPicker'
import { StorageAdapterIcon } from '../StorageAdapterIcon'
import { StorageProviderIcon } from '../StorageProviderIcon'
import { useWorkspaceSlug } from '../../workspace'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

const STORAGE_OPTIONS = [
  { value: 'local', label: 'Local folder' },
  { value: 'webdav', label: 'Remote folder (WebDAV)' },
  { value: 's3', label: 'S3-compatible object storage' },
  { value: 'cloud', label: 'Cloud storage' },
] as const

const CLOUD_PROVIDERS = [
  { value: 'dropbox', label: 'Dropbox' },
  { value: 'google-drive', label: 'Google Drive' },
  { value: 'onedrive', label: 'OneDrive' },
] as const

type CloudProvider = (typeof CLOUD_PROVIDERS)[number]['value']
type CloudConnections = Record<CloudProvider, PublicCloudConnection>

const CLOUD_HELP: Record<
  CloudProvider,
  { consoleUrl: string; credentials: string; intro: string; permissions: string; root: string; secret: string }
> = {
  dropbox: {
    consoleUrl: 'https://www.dropbox.com/developers/apps',
    credentials: 'Create a scoped app with App folder access, then add the redirect URI below.',
    intro: 'Dropbox stores files inside its dedicated app folder.',
    permissions: 'Enable account_info.read, files.metadata.read, files.content.read, and files.content.write.',
    root: 'Leave blank to use the Dropbox app folder directly.',
    secret: 'App secret',
  },
  'google-drive': {
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    credentials: 'Enable the Google Drive API and create an OAuth client for a web application.',
    intro: 'Google Drive stores files in a PrintHub folder using the limited drive.file permission.',
    permissions: 'Add the redirect URI below to the OAuth client’s authorized redirect URIs.',
    root: 'Leave blank to use the PrintHub folder in Google Drive directly.',
    secret: 'Client secret',
  },
  onedrive: {
    consoleUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    credentials: 'Register a web application in Microsoft Entra and create a client secret.',
    intro: 'OneDrive stores files inside the application’s dedicated Apps folder.',
    permissions: 'Add delegated Microsoft Graph permissions for User.Read, Files.ReadWrite, and offline_access.',
    root: 'Leave blank to use the OneDrive app folder directly.',
    secret: 'Client secret',
  },
}

export function StoragePane({ onboarding = false, onSaved }: { onboarding?: boolean; onSaved?: () => void } = {}) {
  const workspaceSlug = useWorkspaceSlug()
  const storageResult = useQuery(storageQuery(workspaceSlug))
  const migrationResult = useQuery(storageMigrationQuery(workspaceSlug))
  const connectionsResult = useQuery(cloudConnectionsQuery())
  const sessionResult = useQuery(sessionQuery(workspaceSlug))
  const current = storageResult.data
  const migration = migrationResult.data
  const cloudConnections = connectionsResult.data
  const session = sessionResult.data
  if (current === undefined || migration === undefined || cloudConnections === undefined || session === undefined) {
    const state = (
      <QueryState
        loading={storageResult.isPending || migrationResult.isPending || connectionsResult.isPending || sessionResult.isPending}
        error={storageResult.error ?? migrationResult.error ?? connectionsResult.error ?? sessionResult.error}
        loadingLabel="Loading storage settings…"
        errorTitle="Could not load storage settings"
        onRetry={() => void retryQueries(storageResult.refetch, migrationResult.refetch, connectionsResult.refetch, sessionResult.refetch)}
      />
    )
    if (onboarding) return state
    return (
      <SettingsPage>
        <SettingsHeader
          title="Storage"
          description="Move finished print files between local folders, S3-compatible providers, and connected cloud storage."
        />
        {state}
      </SettingsPage>
    )
  }
  return (
    <StorageForm
      key={JSON.stringify(current)}
      current={current}
      migration={migration}
      cloudConnections={cloudConnections}
      superAdmin={Boolean(session.identity?.superAdmin)}
      localStorageAllowed={session.localStorageAllowed}
      onboarding={onboarding}
      onSaved={onSaved}
    />
  )
}

function StorageForm({
  current,
  migration,
  cloudConnections,
  superAdmin,
  localStorageAllowed,
  onboarding,
  onSaved,
}: {
  current: StorageConfig
  migration?: PublicStorageMigration | null
  cloudConnections: CloudConnections
  superAdmin: boolean
  localStorageAllowed: boolean
  onboarding: boolean
  onSaved?: () => void
}) {
  const workspaceSlug = useWorkspaceSlug()
  const callUpdate = useServerFn(updateStorageSettings)
  const callStartMigration = useServerFn(startStorageMigration)
  const callRetryMigration = useServerFn(retryStorageMigration)
  const callCancelMigration = useServerFn(cancelStorageMigration)
  const callAcknowledgeMigration = useServerFn(acknowledgeStorageMigration)
  const callBeginCloud = useServerFn(beginCloudConnection)
  const callRemoveCloud = useServerFn(removeCloudConnection)
  const queryClient = useQueryClient()
  const [pendingConfig, setPendingConfig] = useState<StorageConfig>()
  const [starting, setStarting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelMigrationOpen, setCancelMigrationOpen] = useState(false)
  const [startedMigrationId, setStartedMigrationId] = useState<string>()
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [connectingProvider, setConnectingProvider] = useState<CloudProvider>()
  const [disconnectingProvider, setDisconnectingProvider] = useState<CloudProvider>()
  const [permissionProvider, setPermissionProvider] = useState<CloudProvider>()
  const [cloudCredentials, setCloudCredentials] = useState(
    () =>
      Object.fromEntries(
        CLOUD_PROVIDERS.map(({ value }) => [value, { clientId: cloudConnections[value].clientId, clientSecret: '' }]),
      ) as Record<CloudProvider, { clientId: string; clientSecret: string }>,
  )
  const s3 = current.adapter === 's3' ? current : undefined
  const webdav = current.adapter === 'webdav' ? current : undefined
  const currentProvider = s3 ? inferS3Provider(s3.endpoint) : 'backblaze'
  const cloudProviders = superAdmin
    ? CLOUD_PROVIDERS
    : CLOUD_PROVIDERS.filter((provider) => cloudConnections[provider.value].connected || current.adapter === provider.value)
  const storageOptions = STORAGE_OPTIONS.filter(
    (option) => (option.value !== 'local' || localStorageAllowed) && (option.value !== 'cloud' || cloudProviders.length > 0),
  )
  const storageChoices = localStorageAllowed
    ? 'a local folder, remote WebDAV folder, S3-compatible storage, or connected cloud storage'
    : cloudProviders.length
      ? 'a remote WebDAV folder, S3-compatible storage, or connected cloud storage'
      : 'a remote WebDAV folder or S3-compatible storage'
  const form = useForm({
    defaultValues: {
      adapter: !localStorageAllowed && current.adapter === 'local' ? 's3' : current.adapter,
      root: current.adapter === 's3' ? '/prints' : current.root,
      endpoint: s3?.endpoint ?? webdav?.endpoint ?? '',
      provider: currentProvider,
      accountId: cloudflareAccountId(s3?.endpoint),
      region: s3?.region ?? 'us-west-004',
      bucket: s3?.bucket ?? '',
      prefix: s3?.prefix ?? '',
      accessKeyId: s3?.accessKeyId ?? '',
      secretAccessKey: '',
      username: webdav?.username ?? '',
      password: '',
      forcePathStyle: s3?.forcePathStyle ?? true,
    },
    onSubmit: async ({ value }) => {
      const config: StorageConfig =
        value.adapter === 'webdav'
          ? {
              adapter: 'webdav',
              endpoint: value.endpoint,
              root: value.root,
              username: value.username,
              password: value.password,
            }
          : value.adapter === 's3'
            ? {
                adapter: 's3',
                endpoint: s3Endpoint(value.provider, value.region, value.accountId, value.endpoint),
                region: value.provider === 'cloudflare' ? 'auto' : value.region,
                bucket: value.bucket,
                prefix: value.prefix || undefined,
                accessKeyId: value.accessKeyId,
                secretAccessKey: value.secretAccessKey,
                forcePathStyle: value.provider === 'custom' ? value.forcePathStyle : false,
              }
            : { adapter: value.adapter, root: value.root }
      if (isCloudAdapter(config.adapter) && !cloudConnections[config.adapter].connected) {
        toast.error(`Connect ${cloudProviderLabel(config.adapter)} before selecting it as storage.`)
        return
      }
      if (!onboarding) {
        setPendingConfig(config)
        return
      }
      await callUpdate({ data: { ...config, workspaceSlug } })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['storage'] }),
        queryClient.invalidateQueries({ queryKey: ['session'] }),
      ])
      form.reset({ ...value, secretAccessKey: '' })
      onSaved?.()
    },
  })

  useEffect(() => {
    if (!startedMigrationId || migration?.id !== startedMigrationId || migration.state === 'running') return
    if (migration.state === 'completed') {
      toast.success('Storage migration completed. The new location is now active.')
      void Promise.all([queryClient.invalidateQueries({ queryKey: ['storage'] }), queryClient.invalidateQueries({ queryKey: ['session'] })])
    } else if (migration.state === 'cancelled') {
      toast.info('Storage migration cancelled. The original location remains active.')
    } else {
      toast.error(migration.error ?? 'Storage migration failed.')
    }
    setStartedMigrationId(undefined)
  }, [migration, queryClient, startedMigrationId])

  useEffect(() => {
    if (migration?.state !== 'completed' && migration?.state !== 'cancelled') return
    const timer = window.setTimeout(() => {
      void callAcknowledgeMigration({ data: { workspaceSlug } })
        .then(() => queryClient.setQueryData(['storage-migration', workspaceSlug], null))
        .catch(() => undefined)
    }, 3_000)
    return () => window.clearTimeout(timer)
  }, [callAcknowledgeMigration, migration?.id, migration?.state, queryClient, workspaceSlug])

  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const provider = search.get('cloud') as CloudProvider | null
    const outcome = search.get('outcome')
    if (!provider || !isCloudAdapter(provider) || !outcome) return
    const label = cloudProviderLabel(provider)
    if (outcome === 'connected') toast.success(`${label} connected. Choose a subfolder and review the migration.`)
    else if (outcome === 'missing-permissions') {
      setPermissionProvider(provider)
      toast.error(`${label} is missing required permissions. Update the app configuration, then reconnect.`)
    } else toast.error(`${label} could not be connected. Check the client credentials and redirect URI.`)
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  const connectCloud = async (provider: CloudProvider) => {
    setPermissionProvider(undefined)
    setConnectingProvider(provider)
    try {
      const result = await callBeginCloud({
        data: {
          provider,
          ...cloudCredentials[provider],
          returnTo: window.location.pathname,
        },
      })
      window.location.assign(result.url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not start the ${cloudProviderLabel(provider)} connection.`)
      setConnectingProvider(undefined)
    }
  }

  const confirmMigration = async () => {
    if (!pendingConfig) return
    setStarting(true)
    try {
      const started = await callStartMigration({ data: { ...pendingConfig, workspaceSlug } })
      setStartedMigrationId(started.id)
      setPendingConfig(undefined)
      await queryClient.invalidateQueries({ queryKey: ['storage-migration'] })
      toast.success('Storage migration started. Files remain available from the current location until the copy is verified.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start storage migration.')
    } finally {
      setStarting(false)
    }
  }

  const formContent = (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className="flex flex-col gap-4"
    >
      {onboarding && (
        <>
          <h3 className="font-heading text-xl font-semibold">Choose storage</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            PrintHub needs a writable destination before the board is ready. Choose {storageChoices}.
          </p>
        </>
      )}
      {!onboarding && (
        <form.Subscribe selector={(state) => state.isDirty}>{(dirty) => <UnsavedChangesGuard dirty={dirty} />}</form.Subscribe>
      )}
      {!onboarding && migration && (
        <MigrationProgress
          migration={migration}
          retrying={retrying}
          cancelling={cancelling}
          onCancel={() => setCancelMigrationOpen(true)}
          onRetry={() => {
            setRetrying(true)
            void callRetryMigration({ data: { workspaceSlug } })
              .then((retried) => {
                setStartedMigrationId(retried.id)
                return queryClient.invalidateQueries({ queryKey: ['storage-migration'] })
              })
              .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not retry storage migration.'))
              .finally(() => setRetrying(false))
          }}
        />
      )}
      <ConfirmDialog
        open={cancelMigrationOpen}
        title="Cancel storage migration?"
        description="PrintHub will finish the file currently being copied, then stop. The original storage location will remain active, and files already copied to the destination will be left there."
        confirmLabel="Cancel migration"
        destructive
        onCancel={() => setCancelMigrationOpen(false)}
        onConfirm={() => {
          setCancelMigrationOpen(false)
          setCancelling(true)
          void callCancelMigration({ data: { workspaceSlug } })
            .then((cancelled) => {
              queryClient.setQueryData(['storage-migration', workspaceSlug], cancelled)
              toast.info('Cancellation requested. Finishing the current file…')
            })
            .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not cancel storage migration.'))
            .finally(() => setCancelling(false))
        }}
      />
      <Field>
        <FieldLabel htmlFor="storage-adapter">Adapter</FieldLabel>
        <form.Field name="adapter">
          {(field) => (
            <Select
              items={storageOptions}
              value={isCloudAdapter(field.state.value) ? 'cloud' : field.state.value}
              onValueChange={(value) => {
                const adapter =
                  value === 'cloud'
                    ? isCloudAdapter(current.adapter)
                      ? current.adapter
                      : cloudProviders[0].value
                    : (value as 'local' | 'webdav' | 's3')
                field.handleChange(adapter)
                if (adapter === 'local' || adapter === 'webdav' || isCloudAdapter(adapter))
                  form.setFieldValue('root', rootForAdapter(adapter, current))
              }}
            >
              <SelectTrigger className="w-full" id="storage-adapter">
                <SelectValue>
                  <StorageAdapterIcon adapter={isCloudAdapter(field.state.value) ? 'cloud' : field.state.value} />
                  <span>
                    {
                      storageOptions.find((option) => option.value === (isCloudAdapter(field.state.value) ? 'cloud' : field.state.value))!
                        .label
                    }
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {storageOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <StorageAdapterIcon adapter={option.value} />
                    <span>{option.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </form.Field>
      </Field>
      <form.Subscribe selector={(state) => state.values.adapter}>
        {(adapter) =>
          adapter === 'local' ? (
            <Field>
              <FieldLabel htmlFor="storage-root">Folder</FieldLabel>
              <form.Field name="root">
                {(field) => (
                  <>
                    <div className="flex gap-2">
                      <Input
                        id="storage-root"
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        placeholder="/prints"
                        required
                      />
                      <Button type="button" variant="outline" onClick={() => setFolderPickerOpen(true)}>
                        Browse
                      </Button>
                    </div>
                    <ServerFolderPicker
                      open={folderPickerOpen}
                      initialPath={field.state.value}
                      workspaceSlug={workspaceSlug}
                      onSelect={field.handleChange}
                      onClose={() => setFolderPickerOpen(false)}
                    />
                  </>
                )}
              </form.Field>
              <FieldDescription>PrintHub adds a private workspace directory below the selected folder.</FieldDescription>
            </Field>
          ) : adapter === 'webdav' ? (
            <div className="flex flex-col gap-4">
              <Alert>
                <AlertTitle>A normal folder on hardware you control</AlertTitle>
                <AlertDescription>
                  Run a WebDAV server for the folder, then expose it through a stable HTTPS address. Cloudflare Tunnel or Tailscale Funnel
                  can provide the encrypted connection without opening a router port. Files remain visible and movable on your machine.
                </AlertDescription>
              </Alert>
              <form.Field name="endpoint">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="webdav-endpoint">WebDAV endpoint</FieldLabel>
                    <Input
                      id="webdav-endpoint"
                      type="url"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="https://storage.example.com/dav"
                      required
                    />
                    <FieldDescription>Hosted PrintHub requires HTTPS and must be able to reach this address.</FieldDescription>
                  </Field>
                )}
              </form.Field>
              <form.Field name="root">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="webdav-root">Folder</FieldLabel>
                    <Input
                      id="webdav-root"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="printhub"
                    />
                    <FieldDescription>PrintHub adds a private workspace directory below this folder.</FieldDescription>
                  </Field>
                )}
              </form.Field>
              <form.Field name="username">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="webdav-username">Username</FieldLabel>
                    <Input
                      id="webdav-username"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      autoComplete="username"
                      required
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="password">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="webdav-password">Password</FieldLabel>
                    <Input
                      id="webdav-password"
                      type="password"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder={webdav ? 'leave blank to keep current' : ''}
                      autoComplete="current-password"
                      required={!webdav}
                    />
                  </Field>
                )}
              </form.Field>
            </div>
          ) : isCloudAdapter(adapter) ? (
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="cloud-provider">Cloud provider</FieldLabel>
                <Select
                  items={cloudProviders}
                  value={adapter}
                  onValueChange={(value) => {
                    const provider = value as CloudProvider
                    form.setFieldValue('adapter', provider)
                    form.setFieldValue('root', rootForAdapter(provider, current))
                  }}
                >
                  <SelectTrigger className="w-full" id="cloud-provider">
                    <SelectValue>
                      <CloudProviderIcon provider={adapter} />
                      <span>{cloudProviderLabel(adapter)}</span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {cloudProviders.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        <CloudProviderIcon provider={provider.value} />
                        <span>{provider.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="flex items-start gap-3">
                  <CloudProviderIcon provider={adapter} className="mt-0.5 size-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">
                      {cloudConnections[adapter].connected
                        ? `${cloudProviderLabel(adapter)} connected`
                        : `Connect ${cloudProviderLabel(adapter)}`}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {cloudConnections[adapter].connected
                        ? `Signed in${cloudConnections[adapter].accountName ? ` as ${cloudConnections[adapter].accountName}` : ''}${cloudConnections[adapter].accountEmail ? ` (${cloudConnections[adapter].accountEmail})` : ''}.`
                        : CLOUD_HELP[adapter].intro}
                    </p>
                    <a
                      className="mt-2 inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-3"
                      href={CLOUD_HELP[adapter].consoleUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open {cloudProviderLabel(adapter)} developer console
                      <ExternalLink className="size-3.5" />
                    </a>
                    {!cloudConnections[adapter].connected && (
                      <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted-foreground">
                        <li>{CLOUD_HELP[adapter].credentials}</li>
                        <li>{CLOUD_HELP[adapter].permissions}</li>
                        <li>Copy the client ID and secret into PrintHub, then connect the account.</li>
                      </ol>
                    )}
                  </div>
                </div>
              </div>
              {permissionProvider === adapter && (
                <Alert variant="destructive">
                  <AlertTitle>{cloudProviderLabel(adapter)} permissions need updating</AlertTitle>
                  <AlertDescription>{CLOUD_HELP[adapter].permissions} Save the changes, then reconnect.</AlertDescription>
                </Alert>
              )}
              <Field>
                <FieldLabel htmlFor={`${adapter}-callback`}>OAuth redirect URI</FieldLabel>
                <Input id={`${adapter}-callback`} value={cloudConnections[adapter].callbackUrl} readOnly />
                <FieldDescription>Copy this exact URL into the provider’s OAuth redirect URIs.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${adapter}-client-id`}>{adapter === 'dropbox' ? 'App key' : 'Client ID'}</FieldLabel>
                <Input
                  id={`${adapter}-client-id`}
                  value={cloudCredentials[adapter].clientId}
                  onChange={(event) =>
                    setCloudCredentials((credentials) => ({
                      ...credentials,
                      [adapter]: { ...credentials[adapter], clientId: event.target.value },
                    }))
                  }
                  autoComplete="off"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${adapter}-client-secret`}>{CLOUD_HELP[adapter].secret}</FieldLabel>
                <Input
                  id={`${adapter}-client-secret`}
                  type="password"
                  value={cloudCredentials[adapter].clientSecret}
                  onChange={(event) =>
                    setCloudCredentials((credentials) => ({
                      ...credentials,
                      [adapter]: { ...credentials[adapter], clientSecret: event.target.value },
                    }))
                  }
                  placeholder={cloudConnections[adapter].secretConfigured ? 'Leave blank to keep current' : ''}
                  autoComplete="off"
                  required={!cloudConnections[adapter].secretConfigured}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={cloudConnections[adapter].connected ? 'outline' : 'default'}
                  disabled={
                    connectingProvider === adapter ||
                    !cloudCredentials[adapter].clientId ||
                    (!cloudConnections[adapter].secretConfigured && !cloudCredentials[adapter].clientSecret)
                  }
                  onClick={() => void connectCloud(adapter)}
                >
                  {connectingProvider === adapter && <Spinner />}
                  {connectingProvider === adapter
                    ? `Opening ${cloudProviderLabel(adapter)}…`
                    : `${cloudConnections[adapter].connected ? 'Reconnect' : 'Connect'} ${cloudProviderLabel(adapter)}`}
                </Button>
                {cloudConnections[adapter].connected && current.adapter !== adapter && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disconnectingProvider === adapter || migration?.state === 'running'}
                    onClick={() => {
                      setDisconnectingProvider(adapter)
                      void callRemoveCloud({ data: { provider: adapter } })
                        .then(() => queryClient.invalidateQueries({ queryKey: ['cloud-connections'] }))
                        .then(() => toast.success(`${cloudProviderLabel(adapter)} disconnected.`))
                        .catch((error: unknown) =>
                          toast.error(error instanceof Error ? error.message : `Could not disconnect ${cloudProviderLabel(adapter)}.`),
                        )
                        .finally(() => setDisconnectingProvider(undefined))
                    }}
                  >
                    {disconnectingProvider === adapter && <Spinner />}
                    {disconnectingProvider === adapter ? 'Disconnecting…' : 'Disconnect'}
                  </Button>
                )}
              </div>
              <form.Field name="root">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`${adapter}-root`}>Subfolder (optional)</FieldLabel>
                    <Input
                      id={`${adapter}-root`}
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="PrintHub"
                    />
                    <FieldDescription>{CLOUD_HELP[adapter].root}</FieldDescription>
                  </Field>
                )}
              </form.Field>
            </div>
          ) : (
            <>
              <form.Field name="provider">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="storage-provider">Provider</FieldLabel>
                    <Select
                      items={S3_PROVIDERS}
                      value={field.state.value}
                      onValueChange={(provider) => {
                        const next = provider as S3Provider
                        field.handleChange(next)
                        if (next === 'cloudflare') form.setFieldValue('region', 'auto')
                        if (next === 'digitalocean' && form.getFieldValue('region') === 'auto') form.setFieldValue('region', 'nyc3')
                        if (next === 'aws' && form.getFieldValue('region') === 'auto') form.setFieldValue('region', 'us-east-1')
                        if (next === 'custom' && form.getFieldValue('region') === 'us-west-004') form.setFieldValue('region', 'us-east-1')
                      }}
                    >
                      <SelectTrigger className="w-full" id="storage-provider">
                        <SelectValue>
                          <StorageProviderIcon provider={field.state.value} />
                          <span>{s3ProviderLabel(field.state.value)}</span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" alignItemWithTrigger={false} className="min-w-64">
                        {S3_PROVIDERS.map((provider) => (
                          <SelectItem key={provider.value} value={provider.value}>
                            <StorageProviderIcon provider={provider.value} />
                            <span>{provider.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
              <form.Subscribe selector={(state) => state.values.provider}>
                {(provider) => (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                    <p>{S3_PROVIDER_HELP[provider].description}</p>
                    <a
                      className="mt-1 inline-block font-medium text-foreground underline underline-offset-3"
                      href={S3_PROVIDER_HELP[provider].docs}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open setup guide
                    </a>
                  </div>
                )}
              </form.Subscribe>
              <form.Subscribe selector={(state) => state.values.provider}>
                {(provider) =>
                  provider === 'cloudflare' ? (
                    <form.Field name="accountId">
                      {(field) => (
                        <Field>
                          <FieldLabel htmlFor="storage-account-id">Cloudflare account ID</FieldLabel>
                          <Input
                            id="storage-account-id"
                            value={field.state.value}
                            onChange={(event) => field.handleChange(event.target.value)}
                            required
                          />
                        </Field>
                      )}
                    </form.Field>
                  ) : provider === 'custom' ? (
                    <form.Field name="endpoint">
                      {(field) => (
                        <Field>
                          <FieldLabel htmlFor="storage-endpoint">S3 endpoint</FieldLabel>
                          <Input
                            id="storage-endpoint"
                            type="url"
                            value={field.state.value}
                            onChange={(event) => field.handleChange(event.target.value)}
                            placeholder="https://minio.local:9000"
                            required
                          />
                        </Field>
                      )}
                    </form.Field>
                  ) : null
                }
              </form.Subscribe>
              <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
                <form.Field name="bucket">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="storage-bucket">Bucket</FieldLabel>
                      <Input
                        id="storage-bucket"
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        required
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Subscribe selector={(state) => state.values.provider}>
                  {(provider) =>
                    provider !== 'cloudflare' && provider !== 'google-cloud' ? (
                      <form.Field name="region">
                        {(field) => (
                          <Field>
                            <FieldLabel htmlFor="storage-region">Region</FieldLabel>
                            <Input
                              id="storage-region"
                              value={field.state.value}
                              onChange={(event) => field.handleChange(event.target.value)}
                              required
                            />
                          </Field>
                        )}
                      </form.Field>
                    ) : null
                  }
                </form.Subscribe>
              </div>
              <form.Field name="prefix">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="storage-prefix">Key prefix (optional)</FieldLabel>
                    <Input
                      id="storage-prefix"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="printhub"
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="accessKeyId">
                {(field) => (
                  <Field>
                    <form.Subscribe selector={(state) => state.values.provider}>
                      {(provider) => <FieldLabel htmlFor="storage-access">{S3_PROVIDER_HELP[provider].accessKey}</FieldLabel>}
                    </form.Subscribe>
                    <Input
                      id="storage-access"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      autoComplete="off"
                      required
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="secretAccessKey">
                {(field) => (
                  <Field>
                    <form.Subscribe selector={(state) => state.values.provider}>
                      {(provider) => <FieldLabel htmlFor="storage-secret">{S3_PROVIDER_HELP[provider].secretKey}</FieldLabel>}
                    </form.Subscribe>
                    <Input
                      id="storage-secret"
                      type="password"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder={s3 ? 'leave blank to keep current' : ''}
                      autoComplete="off"
                      required={!s3}
                    />
                  </Field>
                )}
              </form.Field>
              <form.Subscribe selector={(state) => state.values.provider}>
                {(provider) =>
                  provider === 'custom' ? (
                    <form.Field name="forcePathStyle">
                      {(field) => (
                        <Field orientation="horizontal">
                          <FieldContent>
                            <FieldLabel htmlFor="storage-path-style">Path-style requests</FieldLabel>
                            <FieldDescription>Required by MinIO and most self-hosted S3 endpoints.</FieldDescription>
                          </FieldContent>
                          <Switch id="storage-path-style" checked={field.state.value} onCheckedChange={field.handleChange} />
                        </Field>
                      )}
                    </form.Field>
                  ) : null
                }
              </form.Subscribe>
            </>
          )
        }
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
        {(error) => <FieldError>{error ? String(error) : ''}</FieldError>}
      </form.Subscribe>
      <form.Subscribe selector={(state) => ({ adapter: state.values.adapter, busy: state.isSubmitting, dirty: state.isDirty })}>
        {({ adapter, busy, dirty }) => (
          <Button
            type="submit"
            disabled={
              busy ||
              (!onboarding && !dirty) ||
              migration?.state === 'running' ||
              (isCloudAdapter(adapter) && !cloudConnections[adapter].connected)
            }
          >
            {busy && <Spinner />}
            {busy
              ? 'Checking storage…'
              : onboarding
                ? isCloudAdapter(adapter) && !cloudConnections[adapter].connected
                  ? `Connect ${cloudProviderLabel(adapter)} first`
                  : 'Finish setup'
                : migration?.state === 'running'
                  ? 'Migration in progress'
                  : isCloudAdapter(adapter) && !cloudConnections[adapter].connected
                    ? `Connect ${cloudProviderLabel(adapter)} first`
                    : dirty
                      ? 'Review migration'
                      : 'No storage changes'}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )

  if (onboarding) return formContent

  return (
    <SettingsPage>
      <SettingsHeader
        title="Storage"
        description={`Move finished print files between ${storageChoices}. PrintHub copies and verifies every file before switching, and leaves the source untouched as a fallback.`}
      />
      <SettingsSection>{formContent}</SettingsSection>
      <ConfirmDialog
        open={!!pendingConfig}
        title="Start storage migration?"
        description="Review the current and new storage locations before copying begins."
        details={
          pendingConfig ? (
            <div className="flex flex-col gap-3">
              <StorageLocation label="Current storage" config={current} />
              <div className="text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">Copy to</div>
              <StorageLocation label="New storage" config={pendingConfig} />
              <p className="text-sm leading-relaxed text-muted-foreground">
                PrintHub verifies every copied file before switching. File changes are paused during migration, and the current files are
                kept as a backup.
              </p>
            </div>
          ) : undefined
        }
        size="lg"
        confirmLabel={starting ? 'Starting…' : 'Start migration'}
        onConfirm={() => void confirmMigration()}
        onCancel={() => !starting && setPendingConfig(undefined)}
      />
    </SettingsPage>
  )
}

function StorageLocation({ label, config }: { label: string; config: StorageConfig }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
        <span className="rounded-full border bg-background px-2 py-0.5 text-xs">
          {config.adapter === 'local'
            ? 'Local folder'
            : config.adapter === 'webdav'
              ? 'Remote folder'
              : config.adapter === 's3'
                ? 'S3'
                : cloudProviderLabel(config.adapter)}
        </span>
      </div>
      <code className="block break-all text-sm leading-relaxed text-foreground">{storageLabel(config)}</code>
    </div>
  )
}

function MigrationProgress({
  migration,
  retrying,
  cancelling,
  onRetry,
  onCancel,
}: {
  migration: PublicStorageMigration
  retrying: boolean
  cancelling: boolean
  onRetry: () => void
  onCancel: () => void
}) {
  const percent = migration.totalBytes
    ? Math.round((migration.copiedBytes / migration.totalBytes) * 100)
    : migration.totalFiles
      ? Math.round((migration.copiedFiles / migration.totalFiles) * 100)
      : 0
  const title =
    migration.state === 'running'
      ? migration.cancelRequestedAt
        ? 'Cancelling migration…'
        : 'Migrating storage'
      : migration.state === 'completed'
        ? 'Migration completed'
        : migration.state === 'cancelled'
          ? 'Migration cancelled'
          : 'Migration failed'
  return (
    <Alert className="min-w-0 overflow-hidden" variant={migration.state === 'failed' ? 'destructive' : 'default'}>
      <AlertTitle className="min-w-0">{title}</AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-2 text-left">
        <span className="truncate" title={`${storageLabel(migration.source)} → ${storageLabel(migration.destination)}`}>
          {storageLabel(migration.source)} → {storageLabel(migration.destination)}
        </span>
        {migration.state === 'running' && <Progress className="min-w-0 max-w-full" value={percent} />}
        <span className="min-w-0">
          {migration.copiedFiles} of {migration.totalFiles || '…'} files · {formatBytes(migration.copiedBytes)} of{' '}
          {migration.totalBytes ? formatBytes(migration.totalBytes) : 'calculating…'}
        </span>
        {migration.currentPath && (
          <span className="block min-w-0 truncate" title={migration.currentPath}>
            Copying {fileName(migration.currentPath)}
          </span>
        )}
        {migration.cancelRequestedAt && migration.state === 'running' && (
          <span>Finishing the current file before stopping. The original storage remains active.</span>
        )}
        {migration.error && <span className="break-words">{migration.error}</span>}
        {migration.state === 'running' && !migration.cancelRequestedAt && (
          <Button className="self-start" variant="outline" size="sm" onClick={onCancel} disabled={cancelling}>
            {cancelling && <Spinner />}
            {cancelling ? 'Requesting…' : 'Cancel migration'}
          </Button>
        )}
        {migration.state === 'failed' && (
          <Button className="self-start" size="sm" onClick={onRetry} disabled={retrying}>
            {retrying && <Spinner />}
            {retrying ? 'Retrying…' : 'Retry migration'}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

export function fileName(path: string) {
  return path.replaceAll('\\', '/').split('/').at(-1) || path
}

function storageLabel(config: StorageConfig) {
  if (config.adapter === 'dropbox' || config.adapter === 'google-drive' || config.adapter === 'onedrive')
    return `${cloudProviderLabel(config.adapter)}${config.root ? `/${config.root}` : ''}`
  if (config.adapter === 'local') return config.root || 'Local storage'
  if (config.adapter === 'webdav') return [config.endpoint.replace(/\/$/, ''), config.root].filter(Boolean).join('/')
  return `${config.endpoint}/${config.bucket}${config.prefix ? `/${config.prefix}` : ''}`
}

function isCloudAdapter(adapter: string): adapter is CloudProvider {
  return adapter === 'dropbox' || adapter === 'google-drive' || adapter === 'onedrive'
}

function rootForAdapter(adapter: 'local' | 'webdav' | CloudProvider, current: StorageConfig) {
  if (adapter === current.adapter) return current.root
  return adapter === 'local' ? '/prints' : adapter === 'webdav' ? 'printhub' : ''
}

function cloudProviderLabel(provider: CloudProvider) {
  return CLOUD_PROVIDERS.find((candidate) => candidate.value === provider)!.label
}

function CloudProviderIcon({ provider, className = 'size-4' }: { provider: CloudProvider; className?: string }) {
  if (provider === 'dropbox') return <SiDropbox className={className} color="#0061ff" aria-hidden="true" />
  if (provider === 'google-drive') return <SiGoogledrive className={className} color="#4285f4" aria-hidden="true" />
  return <TbBrandOnedrive className={className} color="#0078d4" aria-hidden="true" />
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`
}
