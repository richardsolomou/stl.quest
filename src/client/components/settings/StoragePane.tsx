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
import type { StoragePlan } from '../../../core/plans'
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
import { signalProductTourProgress } from '../../productTour'
import { invalidateQueries, retryQueries } from '../../queryState'
import {
  CLOUD_PROVIDERS,
  cloudProviderLabel,
  isCloudAdapter,
  storageLabel,
  storageRecoveryHint,
  type CloudProvider,
  type StorageMessages,
} from '../../storageProviders'
import { rootForStorageAdapter, storageConfigFromForm, storageFormValues, useStorageConfigForm } from '../../storageForm'
import { ConfirmDialog } from '../ConfirmDialog'
import { QueryState } from '../QueryState'
import { ServerFolderPicker } from '../ServerFolderPicker'
import { useWorkspaceSlug } from '../../workspace'
import { useI18n } from '../../i18n'
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

function connectFirstNotice(t: StorageMessages, provider: CloudProvider): Notice {
  return { tone: 'error', title: t.notice.notConnectedTitle(cloudProviderLabel(provider)), hint: t.notice.notConnectedHint }
}

export function StoragePane({
  onboarding = false,
  onSaved,
  onKeepCurrent,
}: { onboarding?: boolean; onSaved?: () => void; onKeepCurrent?: () => void } = {}) {
  const t = useI18n().t.storage
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
        loadingLabel={t.pane.loading}
        errorTitle={t.pane.loadError}
        onRetry={() => void retryQueries(storageResult.refetch, migrationResult.refetch, connectionsResult.refetch, sessionResult.refetch)}
      />
    )
    if (onboarding) return state
    return (
      <SettingsPage>
        <SettingsHeader title={t.pane.title} description={t.pane.loadingDescription} />
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
      managedStoragePlan={session.billing?.plan ?? 'free'}
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
  managedStoragePlan,
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
  managedStoragePlan: StoragePlan
  managedStorageQuotaBytes: number
  onboarding: boolean
  onSaved?: () => void
  onKeepCurrent?: () => void
}) {
  const {
    t: { storage: t },
    locale,
  } = useI18n()
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
  const storageChoices = new Intl.ListFormat(locale, { type: 'disjunction' }).format(
    [
      managedStorageAvailable || current.adapter === 'managed' ? t.pane.choices.managed : undefined,
      localStorageAllowed ? t.pane.choices.local : undefined,
      t.pane.choices.webdav,
      t.pane.choices.s3,
      cloudProviders.length ? t.pane.choices.cloud : undefined,
    ].filter((choice): choice is string => !!choice),
  )
  const defaultValues = storageFormValues(current, localStorageAllowed)
  const form = useStorageConfigForm(defaultValues, async (value) => {
    const config = storageConfigFromForm(value)
    setNotice(undefined)
    if (isCloudAdapter(config.adapter) && !cloudConnections[config.adapter].connected) {
      setNotice(connectFirstNotice(t, config.adapter))
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
      setNotice({ tone: 'error', title: t.notice.notChanged, hint: storageRecoveryHint(t, config.adapter), detail: noticeDetail(error) })
    }
  })

  const testConnection = async () => {
    const config = storageConfigFromForm(form.state.values)
    const configSnapshot = JSON.stringify(config)
    setNotice(undefined)
    if (isCloudAdapter(config.adapter) && !cloudConnections[config.adapter].connected) {
      setNotice(connectFirstNotice(t, config.adapter))
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
        title: t.notice.unusableLocation,
        hint: storageRecoveryHint(t, config.adapter),
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
    setStorageChoice(provider)
    form.setFieldValue('adapter', provider)
    form.setFieldValue('root', rootForStorageAdapter(provider, current))
    const label = cloudProviderLabel(provider)
    if (outcome === 'connected') setNotice({ tone: 'success', title: t.notice.connectedTitle(label), hint: t.notice.connectedHint })
    else if (outcome === 'missing-permissions') setPermissionProvider(provider)
    else
      setNotice({
        tone: 'error',
        title: t.notice.connectFailedTitle(label),
        hint: t.notice.connectFailedHint,
      })
    window.history.replaceState({}, '', window.location.pathname)
  }, [current, form, t])

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
        title: t.notice.openFailedTitle(cloudProviderLabel(provider)),
        hint: t.notice.openFailedHint,
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
          title: t.notice.disconnectFailedTitle(cloudProviderLabel(provider)),
          hint: t.notice.disconnectFailedHint,
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
      setNotice({
        tone: 'error',
        title: t.notice.notChanged,
        hint: storageRecoveryHint(t, change.config.adapter),
        detail: noticeDetail(error),
      })
    }
  }

  const migrationWillRun = !!pendingChange && (pendingChange.migrationRequired || destinationAction === 'clear-all')
  const migrationInProgress = !!startingMigration || migration?.state === 'running'

  const chooseStorage = (adapter: StorageConfig['adapter']) => {
    if (!onboarding) signalProductTourProgress('storage')
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
      managedStoragePlan={managedStoragePlan}
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
      currentActionLabel={onboarding ? undefined : t.pane.editCurrent}
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
              title: t.notice.retryFailedTitle,
              hint: t.notice.retryFailedHint,
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
        <SettingsHeader title={t.pane.title} description={t.pane.description(storageChoices)} />
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
        title={migration?.state === 'failed' ? t.cancelMigration.abandonTitle : t.cancelMigration.stopTitle}
        description={migration?.state === 'failed' ? t.cancelMigration.abandonDescription : t.cancelMigration.stopDescription}
        confirmLabel={migration?.state === 'failed' ? t.cancelMigration.abandonConfirm : t.cancelMigration.stopConfirm}
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
                title: t.notice.stopFailedTitle,
                hint: t.notice.stopFailedHint,
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
      data-onboarding="storage"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className="flex flex-col gap-4"
    >
      {storageChoice && (
        <div className="flex flex-col gap-2">
          <Button type="button" variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground" onClick={showStorageOptions}>
            <ArrowLeft /> {t.pane.allOptions}
          </Button>
          <h3 className="font-heading text-xl font-semibold">
            {(onboarding ? t.pane.setUpHeading : current.adapter === storageChoice ? t.pane.editHeading : t.pane.switchHeading)(
              storageTarget(t, storageChoice),
            )}
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{t.pane.formIntro}</p>
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
              <AlertTitle>{t.pane.managedTitle(formatBytes(managedStorageQuotaBytes, locale))}</AlertTitle>
              <AlertDescription>
                {t.pane.managedBody}
                {managedStorageUsage && <ManagedStorageUsage usage={managedStorageUsage} className="mt-3 space-y-2" />}
              </AlertDescription>
            </Alert>
          ) : adapter === 'local' ? (
            <Field>
              <FieldLabel htmlFor="storage-root">{t.pane.folder}</FieldLabel>
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
                        {t.pane.browse}
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
              <FieldDescription>{t.pane.folderDescription}</FieldDescription>
            </Field>
          ) : adapter === 'webdav' ? (
            <WebDAVStorageFields form={form} current={webdav} />
          ) : isCloudAdapter(adapter) ? (
            <CloudStorageFields
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
                  // Stay clickable while a test runs, so a repeat click retries instead of landing on a dead control.
                  disabled={busy || migrationInProgress || unavailable}
                  onClick={() => void testConnection()}
                >
                  {testing && <Spinner />}
                  {testing ? t.pane.testing : t.pane.testConnection}
                </Button>
                <Button type="submit" disabled={busy || (!onboarding && configured && !dirty) || migrationInProgress || unavailable}>
                  {busy && <Spinner />}
                  {busy
                    ? t.pane.checking
                    : onboarding
                      ? unavailable
                        ? t.pane.connectFirst(cloudProviderLabel(adapter))
                        : t.pane.saveAndContinue
                      : !configured
                        ? t.pane.save
                        : migrationInProgress
                          ? t.pane.migrationInProgress
                          : unavailable
                            ? t.pane.connectFirst(cloudProviderLabel(adapter))
                            : dirty
                              ? t.pane.save
                              : t.pane.noChanges}
                </Button>
                {connectionTested && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <CheckCircle2 className="size-4 text-emerald-600" /> {t.pane.verified}
                  </span>
                )}
              </div>
              {onboarding && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {connectionTested ? t.pane.verifiedOnboarding : t.pane.untestedOnboarding}
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
      <SettingsHeader title={t.pane.title} description={t.pane.description(storageChoices)} />
      <SettingsSection>{formContent}</SettingsSection>
    </SettingsPage>
  )
}

// Only worth showing where the destination is assembled from several fields; a local folder already reads back from its own input.
function StorageDestination({ config }: { config: StorageConfig }) {
  const t = useI18n().t.storage
  if (config.adapter === 'local') return null
  if (config.adapter === 's3' ? !config.bucket : config.adapter === 'webdav' && !config.endpoint) return null
  return (
    <p className="text-sm leading-relaxed text-muted-foreground">
      {t.pane.destination.before}
      <code className="break-all text-foreground">{storageLabel(config, t)}</code>
      {t.pane.destination.after}
    </p>
  )
}

function storageTarget(t: StorageMessages, adapter: StorageConfig['adapter']) {
  if (isCloudAdapter(adapter)) return cloudProviderLabel(adapter)
  return t.pane.target[adapter]
}
