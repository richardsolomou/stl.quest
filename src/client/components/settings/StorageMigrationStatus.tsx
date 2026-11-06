import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import type { PublicStorageMigration, StorageConfig } from '../../../core/types'
import { formatBytes } from '../../../core/format'
import { storageLabel, type StorageMessages } from '../../storageProviders'
import { useI18n } from '../../i18n'

function Route({ t, source, destination }: { t: StorageMessages; source: StorageConfig; destination: StorageConfig }) {
  const route = `${storageLabel(source, t)} → ${storageLabel(destination, t)}`
  return (
    <span className="truncate" title={route}>
      {route}
    </span>
  )
}

export function MigrationStarting({ source, destination }: { source: StorageConfig; destination: StorageConfig }) {
  const t = useI18n().t.storage
  return (
    <Alert className="min-w-0 overflow-hidden">
      <AlertTitle className="flex items-center gap-2">
        <Spinner /> {t.migration.starting}
      </AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-2 text-left">
        <Route t={t} source={source} destination={destination} />
        <span>{t.migration.preparing}</span>
      </AlertDescription>
    </Alert>
  )
}

export function MigrationProgress({
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
  const { t: messages, locale } = useI18n()
  const storage = messages.storage
  const t = storage.migration
  const percent = migration.totalBytes
    ? Math.round((migration.copiedBytes / migration.totalBytes) * 100)
    : migration.totalFiles
      ? Math.round((migration.copiedFiles / migration.totalFiles) * 100)
      : 0
  const clearing = migration.state === 'running' && migration.phase === 'clearing'
  const title =
    migration.state === 'running'
      ? migration.cancelRequestedAt
        ? t.cancelling
        : t.running
      : migration.state === 'completed'
        ? t.completed
        : migration.state === 'cancelled'
          ? t.cancelled
          : t.failed
  return (
    <Alert className="min-w-0 overflow-hidden" variant={migration.state === 'failed' ? 'destructive' : 'default'}>
      <AlertTitle className="min-w-0">{title}</AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-2 text-left">
        <Route t={storage} source={migration.source} destination={migration.destination} />
        {migration.state === 'running' && (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs font-medium">
              <span>{migration.cancelRequestedAt ? t.finishingStep : clearing ? t.clearing : t.copying}</span>
              {!clearing && <span>{percent}%</span>}
            </div>
            <Progress
              className="min-w-0 max-w-full"
              value={clearing ? null : percent}
              aria-label={clearing ? t.clearing : t.progressLabel}
            />
          </div>
        )}
        {!clearing && (
          <span className="min-w-0">
            {t.progress(
              migration.copiedFiles,
              migration.totalFiles,
              formatBytes(migration.copiedBytes, locale),
              migration.totalBytes ? formatBytes(migration.totalBytes, locale) : undefined,
            )}
          </span>
        )}
        {migration.currentPath && (
          <span className="block min-w-0 truncate" title={migration.currentPath}>
            {t.copyingFile(fileName(migration.currentPath))}
          </span>
        )}
        {migration.cancelRequestedAt && migration.state === 'running' && <span>{t.stopping}</span>}
        {migration.state === 'running' && !migration.cancelRequestedAt && <span>{t.originalActive}</span>}
        {(migration.failure || migration.error) && (
          <span className="break-words">
            {migration.failure
              ? storage.migrationFailures[migration.failure.kind](migration.failure.path, formatBytes(migration.failure.bytes, locale))
              : migration.error}
          </span>
        )}
        {migration.state === 'running' && !migration.cancelRequestedAt && (
          <Button className="self-start" variant="outline" size="sm" onClick={onCancel} disabled={cancelling}>
            {cancelling && <Spinner />}
            {cancelling ? t.requesting : t.cancel}
          </Button>
        )}
        {migration.state === 'failed' && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRetry} disabled={retrying || cancelling}>
              {retrying && <Spinner />}
              {retrying ? t.retrying : t.retry}
            </Button>
            {migration.source.adapter !== 'managed' && migration.destination.adapter === 'managed' && (
              <Button variant="outline" size="sm" onClick={onCancel} disabled={retrying || cancelling}>
                {cancelling && <Spinner />}
                {cancelling ? t.cleaningUp : t.abandon}
              </Button>
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}

export function fileName(path: string) {
  return path.replaceAll('\\', '/').split('/').at(-1) || path
}
