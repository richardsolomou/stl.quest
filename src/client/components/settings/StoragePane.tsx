import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import type { PublicStorageMigration, StorageConfig } from '../../../core/types'
import {
  acknowledgeStorageMigration,
  cancelStorageMigration,
  retryStorageMigration,
  startStorageMigration,
  updateStorageSettings,
} from '../../../server/fns'
import { storageMigrationQuery, storageQuery } from '../../queries'
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
import { ServerFolderPicker } from '../ServerFolderPicker'
import { StorageAdapterIcon } from '../StorageAdapterIcon'
import { StorageProviderIcon } from '../StorageProviderIcon'
import { useWorkspaceSlug } from '../../workspace'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

const STORAGE_OPTIONS = [
  { value: 'local', label: 'Local folder' },
  { value: 's3', label: 'S3-compatible object storage' },
] as const

export function StoragePane({ onboarding = false, onSaved }: { onboarding?: boolean; onSaved?: () => void } = {}) {
  const workspaceSlug = useWorkspaceSlug()
  const { data: current } = useQuery(storageQuery(workspaceSlug))
  const { data: migration } = useQuery(storageMigrationQuery(workspaceSlug))
  if (!current) return onboarding ? <h3>Choose storage</h3> : <SettingsHeader title="Storage" description="Loading storage settings…" />
  return <StorageForm key={JSON.stringify(current)} current={current} migration={migration} onboarding={onboarding} onSaved={onSaved} />
}

function StorageForm({
  current,
  migration,
  onboarding,
  onSaved,
}: {
  current: StorageConfig
  migration?: PublicStorageMigration | null
  onboarding: boolean
  onSaved?: () => void
}) {
  const workspaceSlug = useWorkspaceSlug()
  const callUpdate = useServerFn(updateStorageSettings)
  const callStartMigration = useServerFn(startStorageMigration)
  const callRetryMigration = useServerFn(retryStorageMigration)
  const callCancelMigration = useServerFn(cancelStorageMigration)
  const callAcknowledgeMigration = useServerFn(acknowledgeStorageMigration)
  const queryClient = useQueryClient()
  const [pendingConfig, setPendingConfig] = useState<StorageConfig>()
  const [starting, setStarting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelMigrationOpen, setCancelMigrationOpen] = useState(false)
  const [startedMigrationId, setStartedMigrationId] = useState<string>()
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const s3 = current.adapter === 's3' ? current : undefined
  const currentProvider = inferS3Provider(s3?.endpoint)
  const form = useForm({
    defaultValues: {
      adapter: current.adapter,
      root: current.adapter === 'local' ? current.root : '/prints',
      endpoint: s3?.endpoint ?? '',
      provider: currentProvider,
      accountId: cloudflareAccountId(s3?.endpoint),
      region: s3?.region ?? 'us-east-1',
      bucket: s3?.bucket ?? '',
      prefix: s3?.prefix ?? '',
      accessKeyId: s3?.accessKeyId ?? '',
      secretAccessKey: '',
      forcePathStyle: s3?.forcePathStyle ?? true,
    },
    onSubmit: async ({ value }) => {
      const config: StorageConfig =
        value.adapter === 'local'
          ? { adapter: 'local', root: value.root }
          : {
              adapter: 's3',
              endpoint: s3Endpoint(value.provider, value.region, value.accountId, value.endpoint),
              region: value.provider === 'cloudflare' ? 'auto' : value.region,
              bucket: value.bucket,
              prefix: value.prefix || undefined,
              accessKeyId: value.accessKeyId,
              secretAccessKey: value.secretAccessKey,
              forcePathStyle: value.provider === 'custom' ? value.forcePathStyle : false,
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
            PrintHub needs a writable destination before the board is ready. Choose a local folder or S3-compatible storage.
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
              items={STORAGE_OPTIONS}
              value={field.state.value}
              onValueChange={(value) => field.handleChange(value as StorageConfig['adapter'])}
            >
              <SelectTrigger className="w-full" id="storage-adapter">
                <SelectValue>
                  <StorageAdapterIcon adapter={field.state.value} />
                  <span>{STORAGE_OPTIONS.find((option) => option.value === field.state.value)!.label}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STORAGE_OPTIONS.map((option) => (
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
            </Field>
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
              <p className="text-xs leading-relaxed text-muted-foreground">
                Google Drive and Dropbox are not S3-compatible. They require separate OAuth-based storage integrations and are not available
                in this adapter yet.
              </p>
            </>
          )
        }
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
        {(error) => <FieldError>{error ? String(error) : ''}</FieldError>}
      </form.Subscribe>
      <form.Subscribe selector={(state) => ({ busy: state.isSubmitting, dirty: state.isDirty })}>
        {({ busy, dirty }) => (
          <Button type="submit" disabled={busy || (!onboarding && !dirty) || migration?.state === 'running'}>
            {busy && <Spinner />}
            {busy
              ? 'Checking storage…'
              : onboarding
                ? 'Finish setup'
                : migration?.state === 'running'
                  ? 'Migration in progress'
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
        description="Move finished print files between local folders or S3-compatible providers. PrintHub copies and verifies every file before switching, and leaves the source untouched as a fallback."
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
        <span className="rounded-full border bg-background px-2 py-0.5 text-xs">{config.adapter === 'local' ? 'Local folder' : 'S3'}</span>
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
  if (config.adapter === 'local') return config.root
  return `${config.endpoint}/${config.bucket}${config.prefix ? `/${config.prefix}` : ''}`
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`
}
