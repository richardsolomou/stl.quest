import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { ArrowLeft, CheckCircle2, CircleAlert, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import type { PublicCloudConnection } from '../../../core/auth'
import type { PublicStorageMigration, StorageConfig, StorageInventory } from '../../../core/types'
import {
  acknowledgeStorageMigration,
  beginCloudConnection,
  cancelStorageMigration,
  removeCloudConnection,
  retryStorageMigration,
  startStorageMigration,
  testStorageConnection,
  updateStorageSettings,
} from '../../../server/fns'
import { cloudConnectionsQuery, integrationsQuery, sessionQuery, storageMigrationQuery, storageQuery } from '../../queries'
import { retryQueries } from '../../queryState'
import { LATEST_DOCUMENTATION_URL } from '../../sourceCode'
import {
  CLOUD_PROVIDER_HELP,
  CLOUD_PROVIDERS,
  cloudflareAccountId,
  cloudProviderLabel,
  inferS3Provider,
  isCloudAdapter,
  S3_PROVIDER_HELP,
  S3_PROVIDERS,
  s3Endpoint,
  s3ProviderLabel,
  type CloudProvider,
  type S3Provider,
} from '../../storageProviders'
import { CloudProviderIcon } from '../CloudProviderIcon'
import { ConfirmDialog } from '../ConfirmDialog'
import { ProtectedEmail } from '../ProtectedEmail'
import { QueryState } from '../QueryState'
import { ServerFolderPicker } from '../ServerFolderPicker'
import { StorageAdapterIcon } from '../StorageAdapterIcon'
import { StorageProviderIcon } from '../StorageProviderIcon'
import { useWorkspaceSlug } from '../../workspace'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { SettingNotice, noticeDetail, type Notice } from '../SettingNotice'
import { CloudStorageAppDialog } from './CloudStorageAppDialog'
import { StorageChangeDialog } from './StorageChangeDialog'
import { StorageProviderPicker } from './StorageProviderPicker'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

const STORAGE_OPTIONS = [
  { value: 'local', label: 'Local folder' },
  { value: 'webdav', label: 'Remote folder (WebDAV)' },
  { value: 's3', label: 'S3-compatible object storage' },
  { value: 'cloud', label: 'Cloud storage' },
] as const

type CloudConnections = Record<CloudProvider, PublicCloudConnection>

// The server reports precise causes an operator needs; the hint says what to actually go and check.
function whatToCheck(adapter: StorageConfig['adapter']) {
  if (adapter === 'local') return 'Check that the folder exists on the server and that STL Quest can write to it, usually a mounted volume.'
  if (adapter === 'webdav')
    return 'Check the address is reachable over HTTPS from this server, and that the username and password belong to that folder.'
  if (adapter === 's3')
    return 'Check the bucket name, region, and keys, and that the key is allowed to list, read, and write objects in the bucket.'
  return 'Reconnect the account below; the app may have lost the permissions STL Quest needs.'
}

function connectFirstNotice(provider: CloudProvider): Notice {
  return {
    tone: 'error',
    title: `${cloudProviderLabel(provider)} is not connected yet`,
    hint: 'Add the app credentials above and connect the account, then it can be used for storage.',
  }
}

export function StoragePane({
  onboarding = false,
  onSaved,
  onKeepCurrent,
}: { onboarding?: boolean; onSaved?: () => void; onKeepCurrent?: () => void } = {}) {
  const workspaceSlug = useWorkspaceSlug()
  const storageResult = useQuery(storageQuery(workspaceSlug))
  const migrationResult = useQuery(storageMigrationQuery(workspaceSlug))
  const connectionsResult = useQuery(cloudConnectionsQuery(workspaceSlug))
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
      configured={session.storageConfigured}
      superAdmin={Boolean(session.identity?.superAdmin)}
      localStorageAllowed={session.localStorageAllowed}
      onboarding={onboarding}
      onSaved={onSaved}
      onKeepCurrent={onKeepCurrent}
    />
  )
}

function StorageForm({
  current,
  migration,
  cloudConnections,
  configured,
  superAdmin,
  localStorageAllowed,
  onboarding,
  onSaved,
  onKeepCurrent,
}: {
  current: StorageConfig
  migration?: PublicStorageMigration | null
  cloudConnections: CloudConnections
  configured: boolean
  superAdmin: boolean
  localStorageAllowed: boolean
  onboarding: boolean
  onSaved?: () => void
  onKeepCurrent?: () => void
}) {
  const workspaceSlug = useWorkspaceSlug()
  const callUpdate = useServerFn(updateStorageSettings)
  const callTestConnection = useServerFn(testStorageConnection)
  const callStartMigration = useServerFn(startStorageMigration)
  const callRetryMigration = useServerFn(retryStorageMigration)
  const callCancelMigration = useServerFn(cancelStorageMigration)
  const callAcknowledgeMigration = useServerFn(acknowledgeStorageMigration)
  const callBeginCloud = useServerFn(beginCloudConnection)
  const callRemoveCloud = useServerFn(removeCloudConnection)
  const queryClient = useQueryClient()
  const [pendingChange, setPendingChange] = useState<{
    config: StorageConfig
    migrationRequired: boolean
    inventory: StorageInventory
  }>()
  const [destinationAction, setDestinationAction] = useState<'preserve' | 'clear-all'>('preserve')
  const [testing, setTesting] = useState(false)
  const [testedConfig, setTestedConfig] = useState<string>()
  const [retrying, setRetrying] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelMigrationOpen, setCancelMigrationOpen] = useState(false)
  const [startingMigration, setStartingMigration] = useState<{ source: StorageConfig; destination: StorageConfig }>()
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [connectingProvider, setConnectingProvider] = useState<CloudProvider>()
  const [disconnectingProvider, setDisconnectingProvider] = useState<CloudProvider>()
  const [permissionProvider, setPermissionProvider] = useState<CloudProvider>()
  const [onboardingChoice, setOnboardingChoice] = useState<StorageConfig['adapter']>()
  const [preparingServerFolder, setPreparingServerFolder] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const [clearAcknowledged, setClearAcknowledged] = useState(false)
  const [settingUpProvider, setSettingUpProvider] = useState<CloudProvider>()
  // Only a super admin may register the deployment-wide app, so only they can read its credentials.
  const integrations = useQuery({ ...integrationsQuery(), enabled: superAdmin }).data
  const s3 = current.adapter === 's3' ? current : undefined
  const webdav = current.adapter === 'webdav' ? current : undefined
  const currentProvider = s3 ? inferS3Provider(s3.endpoint) : 'backblaze'
  const cloudProviders = CLOUD_PROVIDERS.filter(
    (provider) => superAdmin || cloudConnections[provider.value].available || current.adapter === provider.value,
  ).map((provider) => ({ ...provider, available: cloudConnections[provider.value].available }))
  const storageOptions = STORAGE_OPTIONS.filter(
    (option) => (option.value !== 'local' || localStorageAllowed) && (option.value !== 'cloud' || cloudProviders.length > 0),
  )
  const storageChoices = localStorageAllowed
    ? 'a local folder, remote WebDAV folder, S3-compatible storage, or connected cloud storage'
    : cloudProviders.length
      ? 'a remote WebDAV folder, S3-compatible storage, or connected cloud storage'
      : 'a remote WebDAV folder or S3-compatible storage'
  const defaultValues = {
    adapter: !localStorageAllowed && current.adapter === 'local' ? ('s3' as const) : current.adapter,
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
  }
  const configFromValues = (value: typeof defaultValues): StorageConfig =>
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
  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      const config = configFromValues(value)
      setNotice(undefined)
      if (isCloudAdapter(config.adapter) && !cloudConnections[config.adapter].connected) {
        setNotice(connectFirstNotice(config.adapter))
        return
      }
      try {
        const result = await callUpdate({ data: { ...config, workspaceSlug } })
        if (result.reviewRequired) {
          setPendingChange({ config, migrationRequired: result.migrationRequired, inventory: result.destinationInventory })
          setDestinationAction('preserve')
          // A review or a failure needs the form on screen, even when onboarding submitted the recommended folder directly.
          setOnboardingChoice(config.adapter)
          return
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['storage'] }),
          queryClient.invalidateQueries({ queryKey: ['session'] }),
        ])
        form.reset({ ...value, secretAccessKey: '' })
        onSaved?.()
      } catch (error) {
        setOnboardingChoice(config.adapter)
        setNotice({ tone: 'error', title: 'Storage was not changed', hint: whatToCheck(config.adapter), detail: noticeDetail(error) })
      }
    },
  })

  const testConnection = async () => {
    const config = configFromValues(form.state.values)
    const configSnapshot = JSON.stringify(config)
    setNotice(undefined)
    if (isCloudAdapter(config.adapter) && !cloudConnections[config.adapter].connected) {
      setNotice(connectFirstNotice(config.adapter))
      return
    }
    setTesting(true)
    try {
      await callTestConnection({ data: { ...config, workspaceSlug } })
      if (JSON.stringify(configFromValues(form.state.values)) !== configSnapshot) return
      setTestedConfig(configSnapshot)
    } catch (error) {
      setTestedConfig(undefined)
      setNotice({
        tone: 'error',
        title: 'STL Quest could not use that location',
        hint: whatToCheck(config.adapter),
        detail: noticeDetail(error),
      })
    } finally {
      setTesting(false)
    }
  }

  useEffect(() => {
    if (migration?.state !== 'completed') return
    void Promise.all([queryClient.invalidateQueries({ queryKey: ['storage'] }), queryClient.invalidateQueries({ queryKey: ['session'] })])
  }, [migration?.id, migration?.state, queryClient])

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
    if (outcome === 'connected')
      setNotice({ tone: 'success', title: `${label} is connected`, hint: 'Choose a subfolder if you want one, then save storage.' })
    else if (outcome === 'missing-permissions') setPermissionProvider(provider)
    else
      setNotice({
        tone: 'error',
        title: `${label} could not be connected`,
        hint: 'Check that the client ID, secret, and redirect URI match the app in the provider console, then connect again.',
      })
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  const connectCloud = async (provider: CloudProvider) => {
    setPermissionProvider(undefined)
    setConnectingProvider(provider)
    try {
      const result = await callBeginCloud({
        data: { provider, workspaceSlug, returnTo: window.location.pathname },
      })
      window.location.assign(result.url)
    } catch (error) {
      setNotice({
        tone: 'error',
        title: `Could not open ${cloudProviderLabel(provider)}`,
        hint: 'Check the client ID and secret, then try connecting again.',
        detail: noticeDetail(error),
      })
      setConnectingProvider(undefined)
    }
  }

  const confirmStorageChange = async () => {
    if (!pendingChange) return
    const change = pendingChange
    const acceptedValues = { ...form.state.values }
    const runMigration = change.migrationRequired || destinationAction === 'clear-all'
    setPendingChange(undefined)
    if (runMigration) setStartingMigration({ source: current, destination: change.config })
    try {
      if (runMigration) {
        const started = await callStartMigration({ data: { ...change.config, workspaceSlug, destinationAction } })
        form.reset({ ...acceptedValues, secretAccessKey: '' })
        queryClient.setQueryData(['storage-migration', workspaceSlug], started)
        setStartingMigration(undefined)
      } else {
        await callUpdate({ data: { ...change.config, workspaceSlug, destinationAction } })
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['storage'] }),
          queryClient.invalidateQueries({ queryKey: ['session'] }),
        ])
        form.reset({ ...form.state.values, secretAccessKey: '' })
        onSaved?.()
      }
    } catch (error) {
      setStartingMigration(undefined)
      setPendingChange(change)
      setNotice({ tone: 'error', title: 'Storage was not changed', hint: whatToCheck(change.config.adapter), detail: noticeDetail(error) })
    }
  }

  const migrationWillRun = !!pendingChange && (pendingChange.migrationRequired || destinationAction === 'clear-all')
  const migrationInProgress = !!startingMigration || migration?.state === 'running'

  const chooseOnboardingStorage = (adapter: StorageConfig['adapter']) => {
    setNotice(undefined)
    setOnboardingChoice(adapter)
    form.setFieldValue('adapter', adapter)
    if (adapter === 'local' || adapter === 'webdav' || isCloudAdapter(adapter)) form.setFieldValue('root', rootForAdapter(adapter, current))
  }

  const useServerFolder = async () => {
    setPreparingServerFolder(true)
    form.setFieldValue('adapter', 'local')
    form.setFieldValue('root', rootForAdapter('local', current))
    await form.handleSubmit()
    setPreparingServerFolder(false)
  }

  if (onboarding && !onboardingChoice) {
    return (
      <StorageProviderPicker
        cloudProviders={cloudProviders}
        canSetUpCloud={superAdmin}
        serverFolder={localStorageAllowed ? rootForAdapter('local', current) : undefined}
        inUse={configured ? current : undefined}
        preparing={preparingServerFolder}
        onUseServerFolder={() => void useServerFolder()}
        onKeepCurrent={onKeepCurrent}
        onChoose={chooseOnboardingStorage}
      />
    )
  }

  const reviewDialogs = (
    <>
      <StorageChangeDialog
        change={pendingChange}
        current={current}
        action={destinationAction}
        acknowledged={clearAcknowledged}
        migrationWillRun={migrationWillRun}
        onAction={(next) => {
          setDestinationAction(next)
          setClearAcknowledged(false)
        }}
        onAcknowledge={setClearAcknowledged}
        onConfirm={() => void confirmStorageChange()}
        onCancel={() => {
          setPendingChange(undefined)
          setClearAcknowledged(false)
        }}
      />
      <ConfirmDialog
        open={cancelMigrationOpen}
        title="Stop moving files?"
        description="STL Quest finishes the file it is copying, then stops. Your current storage stays active, and copies already made are left in the new location."
        confirmLabel="Stop the move"
        destructive
        onCancel={() => setCancelMigrationOpen(false)}
        onConfirm={() => {
          setCancelMigrationOpen(false)
          setCancelling(true)
          void callCancelMigration({ data: { workspaceSlug } })
            .then((cancelled) => {
              queryClient.setQueryData(['storage-migration', workspaceSlug], cancelled)
            })
            .catch((error: unknown) =>
              setNotice({
                tone: 'error',
                title: 'Could not stop the move',
                hint: 'The move may have already finished.',
                detail: noticeDetail(error),
              }),
            )
            .finally(() => setCancelling(false))
        }}
      />
    </>
  )

  const formContent = (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className="flex flex-col gap-4"
    >
      {onboarding && onboardingChoice && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 self-start text-muted-foreground"
            onClick={() => setOnboardingChoice(undefined)}
          >
            <ArrowLeft /> All storage options
          </Button>
          <h3 className="font-heading text-xl font-semibold">Set up {onboardingLabel(onboardingChoice)}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Fill in the details below, then test the connection so mistakes surface here instead of on your first upload.
          </p>
        </div>
      )}
      {!onboarding && (
        <form.Subscribe selector={(state) => state.isDirty}>{(dirty) => <UnsavedChangesGuard dirty={dirty} />}</form.Subscribe>
      )}
      {!onboarding && startingMigration ? (
        <MigrationStarting source={startingMigration.source} destination={startingMigration.destination} />
      ) : !onboarding && migration ? (
        <MigrationProgress
          migration={migration}
          retrying={retrying}
          cancelling={cancelling}
          onCancel={() => setCancelMigrationOpen(true)}
          onRetry={() => {
            setRetrying(true)
            void callRetryMigration({ data: { workspaceSlug } })
              .then(() => queryClient.invalidateQueries({ queryKey: ['storage-migration'] }))
              .catch((error: unknown) =>
                setNotice({
                  tone: 'error',
                  title: 'Could not retry the move',
                  hint: 'The new location may have become unreachable.',
                  detail: noticeDetail(error),
                }),
              )
              .finally(() => setRetrying(false))
          }}
        />
      ) : null}
      {!onboarding && (
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
      )}
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
              <FieldDescription>
                Must be writable by the STL Quest process, so usually a mounted volume. A private workspace directory is created below it.
              </FieldDescription>
            </Field>
          ) : adapter === 'webdav' ? (
            <div className="flex flex-col gap-4">
              <Alert>
                <AlertTitle>A normal folder on hardware you control</AlertTitle>
                <AlertDescription>
                  Run a WebDAV server for the folder, then expose it through a stable HTTPS address. Cloudflare Tunnel or Tailscale Funnel
                  can provide the encrypted connection without opening a router port. Files remain visible and movable on your machine.{' '}
                  <a
                    className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-3"
                    href={`${LATEST_DOCUMENTATION_URL}/webdav-cloudflare-tunnel.md`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Set up Cloudflare Tunnel
                    <ExternalLink className="size-3.5" />
                  </a>
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
                    <FieldDescription>Hosted STL Quest requires HTTPS and must be able to reach this address.</FieldDescription>
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
                      placeholder="stlquest"
                    />
                    <FieldDescription>STL Quest adds a private workspace directory below this folder.</FieldDescription>
                  </Field>
                )}
              </form.Field>
              <FieldSet>
                <FieldLegend>Credentials</FieldLegend>
                <FieldDescription>Use a login dedicated to STL Quest rather than the account that administers the server.</FieldDescription>
                <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
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
              </FieldSet>
            </div>
          ) : isCloudAdapter(adapter) ? (
            <div className="flex flex-col gap-4">
              {!onboarding && (
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
              )}
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="flex items-start gap-3">
                  <CloudProviderIcon provider={adapter} className="mt-0.5 size-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                      {cloudConnections[adapter].connected ? cloudProviderLabel(adapter) : `Connect ${cloudProviderLabel(adapter)}`}
                      {cloudConnections[adapter].connected && (
                        <Badge>
                          <CheckCircle2 /> Connected
                        </Badge>
                      )}
                    </p>
                    <div className="mt-1 text-muted-foreground">
                      {cloudConnections[adapter].connected ? (
                        <p className="flex flex-wrap items-center gap-x-1">
                          <span>
                            Signed in{cloudConnections[adapter].accountName ? ` as ${cloudConnections[adapter].accountName}` : ''}
                          </span>
                          {cloudConnections[adapter].accountEmail ? (
                            <span className="inline-flex">
                              (<ProtectedEmail email={cloudConnections[adapter].accountEmail} />
                              ).
                            </span>
                          ) : (
                            '.'
                          )}
                        </p>
                      ) : (
                        <p>{CLOUD_PROVIDER_HELP[adapter].intro}</p>
                      )}
                    </div>
                    {!cloudConnections[adapter].connected && (
                      <p className="mt-2 text-muted-foreground">
                        {cloudConnections[adapter].available
                          ? `Sign in below and STL Quest writes this workspace's models into your own ${cloudProviderLabel(adapter)}.`
                          : superAdmin
                            ? `${cloudProviderLabel(adapter)} needs a one-time setup for this deployment. Do it once and every workspace, including this one, can connect its own account.`
                            : `An administrator has to set ${cloudProviderLabel(adapter)} up for this deployment before it can be connected.`}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              {permissionProvider === adapter && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertTitle>{cloudProviderLabel(adapter)} did not grant the access STL Quest needs</AlertTitle>
                  <AlertDescription>
                    The deployment’s {cloudProviderLabel(adapter)} app is missing permissions. An administrator has to update it in
                    Integrations, then you can connect again.
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                {!cloudConnections[adapter].available && superAdmin && (
                  <Button type="button" onClick={() => setSettingUpProvider(adapter)}>
                    Set up the {cloudProviderLabel(adapter)} app
                  </Button>
                )}
                <Button
                  type="button"
                  variant={cloudConnections[adapter].connected || !cloudConnections[adapter].available ? 'outline' : 'default'}
                  disabled={connectingProvider === adapter || !cloudConnections[adapter].available}
                  onClick={() => void connectCloud(adapter)}
                >
                  {connectingProvider === adapter && <Spinner />}
                  {connectingProvider === adapter
                    ? `Opening ${cloudProviderLabel(adapter)}…`
                    : `${cloudConnections[adapter].connected ? 'Reconnect' : 'Connect'} my ${cloudProviderLabel(adapter)}`}
                </Button>
                {cloudConnections[adapter].connected && current.adapter !== adapter && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disconnectingProvider === adapter || migrationInProgress}
                    onClick={() => {
                      setDisconnectingProvider(adapter)
                      void callRemoveCloud({ data: { provider: adapter, workspaceSlug } })
                        .then(() => queryClient.invalidateQueries({ queryKey: ['cloud-connections'] }))
                        .catch((error: unknown) =>
                          setNotice({
                            tone: 'error',
                            title: `Could not disconnect ${cloudProviderLabel(adapter)}`,
                            hint: 'Try again in a moment.',
                            detail: noticeDetail(error),
                          }),
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
                      placeholder="STL Quest"
                    />
                    <FieldDescription>{CLOUD_PROVIDER_HELP[adapter].root}</FieldDescription>
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
              <FieldSet>
                <FieldLegend>Bucket</FieldLegend>
                <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
                  <form.Field name="bucket">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="storage-bucket">Name</FieldLabel>
                        <Input
                          id="storage-bucket"
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          placeholder="stlquest-models"
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
                              <FieldDescription>Must match the bucket’s region.</FieldDescription>
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
                        placeholder="stlquest"
                      />
                      <FieldDescription>Keeps STL Quest below one path so the bucket can hold other data.</FieldDescription>
                    </Field>
                  )}
                </form.Field>
              </FieldSet>
              <FieldSet>
                <FieldLegend>Access keys</FieldLegend>
                <FieldDescription>Create a key limited to this bucket rather than reusing an account-wide key.</FieldDescription>
                <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
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
                </div>
              </FieldSet>
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
      <SettingNotice notice={notice} />
      <form.Subscribe selector={(state) => state.values}>
        {(values) => <StorageDestination config={configFromValues(values)} />}
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
        {(error) => <FieldError>{error ? String(error) : ''}</FieldError>}
      </form.Subscribe>
      <form.Subscribe selector={(state) => ({ values: state.values, busy: state.isSubmitting, dirty: state.isDirty })}>
        {({ values, busy, dirty }) => {
          const adapter = values.adapter
          const unavailable = isCloudAdapter(adapter) && !cloudConnections[adapter].connected
          const connectionTested = testedConfig === JSON.stringify(configFromValues(values))
          return (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || testing || migrationInProgress || unavailable}
                  onClick={() => void testConnection()}
                >
                  {testing && <Spinner />}
                  {testing ? 'Testing…' : 'Test connection'}
                </Button>
                <Button type="submit" disabled={busy || (!onboarding && configured && !dirty) || migrationInProgress || unavailable}>
                  {busy && <Spinner />}
                  {busy
                    ? 'Checking storage…'
                    : onboarding
                      ? unavailable
                        ? `Connect ${cloudProviderLabel(adapter)} first`
                        : 'Save and continue'
                      : !configured
                        ? 'Save storage'
                        : migrationInProgress
                          ? 'Migration in progress'
                          : unavailable
                            ? `Connect ${cloudProviderLabel(adapter)} first`
                            : dirty
                              ? 'Save storage'
                              : 'No storage changes'}
                </Button>
                {connectionTested && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <CheckCircle2 className="size-4 text-emerald-600" /> Connection verified
                  </span>
                )}
              </div>
              {onboarding && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {connectionTested
                    ? 'Storage is reachable and writable. Printers come next, and you can skip them.'
                    : 'Nothing is uploaded yet. STL Quest writes a temporary file to confirm the location is writable.'}
                </p>
              )}
            </div>
          )
        }}
      </form.Subscribe>
      {reviewDialogs}
      {settingUpProvider && integrations && (
        <CloudStorageAppDialog
          provider={settingUpProvider}
          current={integrations.cloudStorage[settingUpProvider]}
          onDone={() => setSettingUpProvider(undefined)}
        />
      )}
    </form>
  )

  if (onboarding) return formContent

  return (
    <SettingsPage>
      <SettingsHeader
        title="Storage"
        description={`Move finished print files between ${storageChoices}. STL Quest copies and verifies every file before switching, and leaves the source untouched as a fallback.`}
      />
      <SettingsSection>{formContent}</SettingsSection>
    </SettingsPage>
  )
}

// Only worth showing where the destination is assembled from several fields; a local folder already reads back from its own input.
function StorageDestination({ config }: { config: StorageConfig }) {
  if (config.adapter === 'local') return null
  if (config.adapter === 's3' ? !config.bucket : config.adapter === 'webdav' && !config.endpoint) return null
  return (
    <p className="text-sm leading-relaxed text-muted-foreground">
      Models will be written to a private workspace folder below <code className="break-all text-foreground">{storageLabel(config)}</code>.
    </p>
  )
}

function MigrationStarting({ source, destination }: { source: StorageConfig; destination: StorageConfig }) {
  return (
    <Alert className="min-w-0 overflow-hidden">
      <AlertTitle className="flex items-center gap-2">
        <Spinner /> Starting migration…
      </AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-2 text-left">
        <span className="truncate" title={`${storageLabel(source)} → ${storageLabel(destination)}`}>
          {storageLabel(source)} → {storageLabel(destination)}
        </span>
        <span>Validating and preparing the destination. The current storage remains active.</span>
      </AlertDescription>
    </Alert>
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
  const clearing = migration.state === 'running' && migration.phase === 'clearing'
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
        {migration.state === 'running' && (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs font-medium">
              <span>
                {migration.cancelRequestedAt
                  ? 'Finishing current step'
                  : clearing
                    ? 'Deleting destination contents'
                    : 'Copying and verifying files'}
              </span>
              {!clearing && <span>{percent}%</span>}
            </div>
            <Progress
              className="min-w-0 max-w-full"
              value={clearing ? null : percent}
              aria-label={clearing ? 'Deleting destination contents' : 'Storage migration progress'}
            />
          </div>
        )}
        {!clearing && (
          <span className="min-w-0">
            {migration.copiedFiles} of {migration.totalFiles || '…'} files · {formatBytes(migration.copiedBytes)} of{' '}
            {migration.totalBytes ? formatBytes(migration.totalBytes) : 'calculating…'}
          </span>
        )}
        {migration.currentPath && (
          <span className="block min-w-0 truncate" title={migration.currentPath}>
            Copying {fileName(migration.currentPath)}
          </span>
        )}
        {migration.cancelRequestedAt && migration.state === 'running' && (
          <span>Finishing the current file before stopping. The original storage remains active.</span>
        )}
        {migration.state === 'running' && !migration.cancelRequestedAt && (
          <span>The original storage remains active until verification completes.</span>
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

function rootForAdapter(adapter: 'local' | 'webdav' | CloudProvider, current: StorageConfig) {
  if (adapter === current.adapter) return current.root
  return adapter === 'local' ? '/prints' : adapter === 'webdav' ? 'stlquest' : ''
}

function onboardingLabel(adapter: StorageConfig['adapter']) {
  if (isCloudAdapter(adapter)) return cloudProviderLabel(adapter)
  if (adapter === 'local') return 'a folder on this server'
  if (adapter === 'webdav') return 'a remote folder'
  return 'an S3-compatible bucket'
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`
}
