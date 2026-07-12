import { useQuery } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FieldDescription } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { diagnosticsQuery } from '../../queries'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

export function DiagnosticsPane() {
  const { data, error, isFetching, refetch } = useQuery(diagnosticsQuery())
  return (
    <SettingsPage>
      <SettingsHeader title="Diagnostics" description="Inspect authentication, storage, database, upload, and asset-processing health." />
      <SettingsSection>
        {!data && !error && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Spinner /> Checking system health…
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        {data && (
          <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-4 gap-y-2.5 max-sm:grid-cols-1 [&_dt]:text-muted-foreground [&_dd]:m-0">
            <dt>Version</dt>
            <dd>{data.version}</dd>
            <dt>Storage</dt>
            <dd>
              {data.storage} · {data.storageReady ? 'ready' : 'unavailable'}
            </dd>
            <dt>Authentication</dt>
            <dd>
              {[data.authentication.password && 'password', ...data.authentication.socialProviders].filter(Boolean).join(', ') || 'none'}
            </dd>
            <dt>Email</dt>
            <dd>{data.authentication.smtpConfigured ? 'configured' : 'not configured'}</dd>
            <dt>Asset queue</dt>
            <dd>
              {data.queue.queued} queued · {data.queue.pending} running
            </dd>
            <dt>Incomplete uploads</dt>
            <dd>
              {data.incompleteUploads.count} · {formatBytes(data.incompleteUploads.bytes)}
            </dd>
            <dt>Database</dt>
            <dd>
              {formatBytes(data.database.sizeBytes)} · integrity {data.database.integrity}
            </dd>
            <dt>Data disk free</dt>
            <dd>{data.dataCapacity ? formatBytes(data.dataCapacity.freeBytes) : 'n/a'}</dd>
            <dt>Storage disk free</dt>
            <dd>{data.storageCapacity ? formatBytes(data.storageCapacity.freeBytes) : 'n/a for S3'}</dd>
          </dl>
        )}
      </SettingsSection>
      <SettingsActions>
        <Button type="button" variant="outline" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching && <Spinner />}
          {isFetching ? 'Checking…' : 'Refresh diagnostics'}
        </Button>
      </SettingsActions>
      <FieldDescription>
        Prometheus metrics are available at <code>/api/metrics</code>. Set METRICS_TOKEN to protect that endpoint.
      </FieldDescription>
    </SettingsPage>
  )
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`
}
