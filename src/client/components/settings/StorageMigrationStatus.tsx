import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import type { PublicStorageMigration, StorageConfig } from '../../../core/types'
import { formatBytes } from '../../../core/format'
import { storageLabel } from '../../storageProviders'

const locationLabel = (config: StorageConfig) => storageLabel(config, 'Included storage (1 GB)')

export function MigrationStarting({ source, destination }: { source: StorageConfig; destination: StorageConfig }) {
  return (
    <Alert className="min-w-0 overflow-hidden">
      <AlertTitle className="flex items-center gap-2">
        <Spinner /> Starting migration…
      </AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-2 text-left">
        <span className="truncate" title={`${locationLabel(source)} → ${locationLabel(destination)}`}>
          {locationLabel(source)} → {locationLabel(destination)}
        </span>
        <span>Validating and preparing the destination. The current storage remains active.</span>
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
        <span className="truncate" title={`${locationLabel(migration.source)} → ${locationLabel(migration.destination)}`}>
          {locationLabel(migration.source)} → {locationLabel(migration.destination)}
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRetry} disabled={retrying || cancelling}>
              {retrying && <Spinner />}
              {retrying ? 'Retrying…' : 'Retry migration'}
            </Button>
            {migration.source.adapter !== 'managed' && migration.destination.adapter === 'managed' && (
              <Button variant="outline" size="sm" onClick={onCancel} disabled={retrying || cancelling}>
                {cancelling && <Spinner />}
                {cancelling ? 'Cleaning up…' : 'Abandon migration'}
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
