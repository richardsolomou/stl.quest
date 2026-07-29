import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import type { PublicCloudConnection } from '../../../core/auth'
import { formatBytes } from '../../../core/format'
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
import { invalidateQueries, retryQueries } from '../../queryState'
import { CLOUD_PROVIDERS, cloudProviderLabel, isCloudAdapter, storageLabel, type CloudProvider } from '../../storageProviders'
import { rootForStorageAdapter, storageConfigFromForm, storageFormValues, useStorageConfigForm } from '../../storageForm'
import { ConfirmDialog } from '../ConfirmDialog'
import { QueryState } from '../QueryState'
import { ServerFolderPicker } from '../ServerFolderPicker'
import { useWorkspaceSlug } from '../../workspace'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { SettingNotice, noticeDetail, type Notice } from '../SettingNotice'
import { CloudStorageAppDialog } from './CloudStorageAppDialog'
import { StorageChangeDialog } from './StorageChangeDialog'
import { MigrationProgress, MigrationStarting } from './StorageMigrationStatus'
import { ManagedStorageUsage, type ManagedStorageUsageValue } from './ManagedStorageUsage'
import { StorageProviderPicker } from './StorageProviderPicker'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'
import { S3StorageFields } from './S3StorageFields'
import { WebDAVStorageFields } from './WebDAVStorageFields'
import { CloudStorageFields } from './CloudStorageFields'

type CloudConnections = Record<CloudProvider, PublicCloudConnection>

const refreshStorageSettings = (queryClient: ReturnType<typeof useQueryClient>) => invalidateQueries(queryClient, 'storage', 'session')

// The server reports precise causes an operator needs; the hint says what to actually go and check.
function whatToCheck(adapter: StorageConfig['adapter']) {
  if (adapter === 'managed') return 'Try again, or contact the hosted service operator if included storage remains unavailable.'
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
      managedStorageAvailable={session.managedStorageAvailable}
      managedStorageEligible={session.managedStorageEligible}
      managedStorageUnavailableReason={session.managedStorageUnavailableReason}
      managedStorageUsage={session.managedStorageUsage}
      managedStorageQuotaBytes={session.billing?.plans[session.billing.plan].quotaBytes ?? 1_000_000_000}
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
  managedStorageAvailable,
  managedStorageEligible,
  managedStorageUnavailableReason,
  managedStorageUsage,
  managedStorageQuotaBytes,
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
  managedStorageAvailable: boolean
  managedStorageEligible: boolean
  managedStorageUnavailableReason?: string
  managedStorageUsage?: ManagedStorageUsageValue
  managedStorageQuotaBytes: number
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
  const [storageChoice, setStorageChoice] = useState<StorageConfig['adapter']>()
  const [preparingStorage, setPreparingStorage] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const [clearAcknowledged, setClearAcknowledged] = useState(false)
  const [settingUpProvider, setSettingUpProvider] = useState<CloudProvider>()
  // Only a super admin may register the deployment-wide app, so only they can read its credentials.
  const integrations = useQuery({ ...integrationsQuery(), enabled: superAdmin }).data
  const s3 = current.adapter === 's3' ? current : undefined
  const webdav = current.adapter === 'webdav' ? current : undefined
  const cloudProviders = CLOUD_PROVIDERS.filter(
    (provider) => superAdmin || cloudConnections[provider.value].available || current.adapter === provider.value,
  ).map((provider) => ({ ...provider, available: cloudConnections[provider.value].available }))
  const storageChoices = joinChoices([
    managedStorageAvailable || current.adapter === 'managed' ? 'included storage' : undefined,
    localStorageAllowed ? 'a local folder' : undefined,
    'a remote WebDAV folder',
    'S3-compatible storage',
    cloudProviders.length ? 'connected cloud storage' : undefined,
  ])
  const defaultValues = storageFormValues(current, localStorageAllowed)
  const form = useStorageConfigForm(defaultValues, async (value) => {
    const config = storageConfigFromForm(value)
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
        setStorageChoice(config.adapter)
        return
      }
      await refreshStorageSettings(queryClient)
      form.reset({ ...value, secretAccessKey: '' })
      onSaved?.()
    } catch (error) {
      setStorageChoice(config.adapter)
      setNotice({ tone: 'error', title: 'Storage was not changed', hint: whatToCheck(config.adapter), detail: noticeDetail(error) })
    }
  })

  const testConnection = async () => {
    const config = storageConfigFromForm(form.state.values)
    const configSnapshot = JSON.stringify(config)
    setNotice(undefined)
    if (isCloudAdapter(config.adapter) && !cloudConnections[config.adapter].connected) {
      setNotice(connectFirstNotice(config.adapter))
      return
    }
    setTesting(true)
    try {
      await callTestConnection({ data: { ...config, workspaceSlug } })
      if (JSON.stringify(storageConfigFromForm(form.state.values)) !== configSnapshot) return
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
    void refreshStorageSettings(queryClient)
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

  const disconnectCloud = (provider: CloudProvider) => {
    setDisconnectingProvider(provider)
    void callRemoveCloud({ data: { provider, workspaceSlug } })
      .then(() => queryClient.invalidateQueries({ queryKey: ['cloud-connections'] }))
      .catch((error: unknown) =>
        setNotice({
          tone: 'error',
          title: `Could not disconnect ${cloudProviderLabel(provider)}`,
          hint: 'Try again in a moment.',
          detail: noticeDetail(error),
        }),
      )
      .finally(() => setDisconnectingProvider(undefined))
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
        await refreshStorageSettings(queryClient)
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

  const chooseStorage = (adapter: StorageConfig['adapter']) => {
    setNotice(undefined)
    setStorageChoice(adapter)
    form.setFieldValue('adapter', adapter)
    if (adapter === 'local' || adapter === 'webdav' || isCloudAdapter(adapter))
      form.setFieldValue('root', rootForStorageAdapter(adapter, current))
  }

  const showStorageOptions = () => {
    form.reset(defaultValues)
    setTestedConfig(undefined)
    setNotice(undefined)
    setStorageChoice(undefined)
  }

  const prepareStorage = async (adapter: 'local' | 'managed') => {
    setPreparingStorage(true)
    form.setFieldValue('adapter', adapter)
    if (adapter === 'local') form.setFieldValue('root', rootForStorageAdapter(adapter, current))
    try {
      await form.handleSubmit()
    } finally {
      setPreparingStorage(false)
    }
  }

  const providerPicker = (
    <StorageProviderPicker
      cloudProviders={cloudProviders}
      canSetUpCloud={superAdmin}
      serverFolder={localStorageAllowed ? rootForStorageAdapter('local', current) : undefined}
      managedStorage={managedStorageAvailable && managedStorageEligible}
      managedStorageUnavailableReason={managedStorageUnavailableReason}
      managedStorageUsage={managedStorageUsage}
      managedStorageQuotaBytes={managedStorageQuotaBytes}
      inUse={configured ? current : undefined}
      preparing={preparingStorage}
      onUseServerFolder={() => void prepareStorage('local')}
      onUseManagedStorage={() => void prepareStorage('managed')}
      onKeepCurrent={
        onboarding
          ? onKeepCurrent
          : current.adapter === 'managed' || (current.adapter === 'local' && !localStorageAllowed)
            ? undefined
            : () => chooseStorage(current.adapter)
      }
      currentActionLabel={onboarding ? undefined : 'Edit current storage'}
      settings={!onboarding}
      onChoose={chooseStorage}
    />
  )

  const migrationBanner = startingMigration ? (
    <MigrationStarting source={startingMigration.source} destination={startingMigration.destination} />
  ) : migration ? (
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
  ) : null

  if (onboarding && !storageChoice) return providerPicker

  // A failed migration must not trap the admin on "Retry": the destination can be gone for good, and
  // the picker is the only way left to choose a different one. Every other state keeps the form.
  const pickerBlockedByMigration = !!startingMigration || (!!migration && migration.state !== 'failed')

  if (!onboarding && !storageChoice && !pickerBlockedByMigration) {
    return (
      <SettingsPage>
        <SettingsHeader
          title="Storage"
          description={`Move finished print files between ${storageChoices}. STL Quest copies and verifies every file before switching, and leaves the source untouched as a fallback.`}
        />
        {migrationBanner && <SettingsSection>{migrationBanner}</SettingsSection>}
        <SettingsSection>{providerPicker}</SettingsSection>
      </SettingsPage>
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
        title={migration?.state === 'failed' ? 'Abandon failed migration?' : 'Stop moving files?'}
        description={
          migration?.state === 'failed'
            ? 'STL Quest deletes partial managed-storage copies and releases the included allowance. Your current storage stays active.'
            : 'STL Quest finishes the file it is copying, then stops. Your current storage stays active, and copies already made are left in the new location.'
        }
        confirmLabel={migration?.state === 'failed' ? 'Delete partial copies' : 'Stop the move'}
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
      {storageChoice && (
        <div className="flex flex-col gap-2">
          <Button type="button" variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground" onClick={showStorageOptions}>
            <ArrowLeft /> All storage options
          </Button>
          <h3 className="font-heading text-xl font-semibold">
            {onboarding ? 'Set up' : current.adapter === storageChoice ? 'Edit' : 'Switch to'} {onboardingLabel(storageChoice)}
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Fill in the details below, then test the connection so mistakes surface here instead of on your first upload.
          </p>
        </div>
      )}
      {!onboarding && (
        <form.Subscribe selector={(state) => state.isDirty}>{(dirty) => <UnsavedChangesGuard dirty={dirty} />}</form.Subscribe>
      )}
      {!onboarding && migrationBanner}
      <form.Subscribe selector={(state) => state.values.adapter}>
        {(adapter) =>
          adapter === 'managed' ? (
            <Alert>
              <AlertTitle>{formatBytes(managedStorageQuotaBytes)} of included storage</AlertTitle>
              <AlertDescription>
                Hosted by STL Quest and shared across your workspaces. Models, previews, thumbnails, optimized assets, and recoverable trash
                count toward this allowance. Delete files to release space, or switch to storage you own for a larger library.
                {managedStorageUsage && <ManagedStorageUsage usage={managedStorageUsage} className="mt-3 space-y-2" />}
              </AlertDescription>
            </Alert>
          ) : adapter === 'local' ? (
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
            <WebDAVStorageFields form={form} current={webdav} />
          ) : isCloudAdapter(adapter) ? (
            <CloudStorageFields
              form={form}
              provider={adapter}
              providers={cloudProviders}
              connections={cloudConnections}
              currentAdapter={current.adapter}
              onboarding={onboarding}
              superAdmin={superAdmin}
              permissionProvider={permissionProvider}
              connectingProvider={connectingProvider}
              disconnectingProvider={disconnectingProvider}
              migrationInProgress={migrationInProgress}
              onProviderChange={(provider) => {
                form.setFieldValue('adapter', provider)
                form.setFieldValue('root', rootForStorageAdapter(provider, current))
              }}
              onSetUp={setSettingUpProvider}
              onConnect={(provider) => void connectCloud(provider)}
              onDisconnect={disconnectCloud}
            />
          ) : (
            <S3StorageFields form={form} current={s3} />
          )
        }
      </form.Subscribe>
      <SettingNotice notice={notice} />
      <form.Subscribe selector={(state) => state.values}>
        {(values) => <StorageDestination config={storageConfigFromForm(values)} />}
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
        {(error) => <FieldError>{error ? String(error) : ''}</FieldError>}
      </form.Subscribe>
      <form.Subscribe selector={(state) => ({ values: state.values, busy: state.isSubmitting, dirty: state.isDirty })}>
        {({ values, busy, dirty }) => {
          const adapter = values.adapter
          const unavailable = isCloudAdapter(adapter) && !cloudConnections[adapter].connected
          const connectionTested = testedConfig === JSON.stringify(storageConfigFromForm(values))
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

function onboardingLabel(adapter: StorageConfig['adapter']) {
  if (adapter === 'managed') return 'included storage'
  if (isCloudAdapter(adapter)) return cloudProviderLabel(adapter)
  if (adapter === 'local') return 'a folder on this server'
  if (adapter === 'webdav') return 'a remote folder'
  return 'an S3-compatible bucket'
}

function joinChoices(choices: Array<string | undefined>) {
  const available = choices.filter((choice): choice is string => !!choice)
  return available.length === 1 ? available[0] : `${available.slice(0, -1).join(', ')}, or ${available.at(-1)}`
}
