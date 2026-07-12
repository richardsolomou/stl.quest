import { useQuery } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FieldDescription } from '@/components/ui/field'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { diagnosticsQuery } from '../../queries'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

export function DiagnosticsPane() {
  const { data, error, isFetching, refetch } = useQuery(diagnosticsQuery())
  const backgroundJobs = data?.backgroundJobs ?? []
  const unfinishedJobs = backgroundJobs.filter((job) => !['ready', 'skipped'].includes(job.status))
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
      {data && (
        <SettingsSection
          title="Background jobs"
          description="Tracks thumbnail, lightweight-preview, and resin-orientation work. Visual assets run before low-priority orientation analysis."
        >
          <div className="grid gap-3 md:grid-cols-3">
            {(['thumbnail', 'preview', 'orientation'] as const).map((kind) => {
              const jobs = backgroundJobs.filter((job) => job.kind === kind)
              const complete = jobs.filter((job) => job.status === 'ready' || job.status === 'skipped').length
              return (
                <Progress key={kind} value={jobs.length ? (complete / jobs.length) * 100 : 100}>
                  <ProgressLabel>{jobKindLabel(kind)}</ProgressLabel>
                  <ProgressValue>{() => (jobs.length ? `${complete}/${jobs.length}` : 'No jobs')}</ProgressValue>
                </Progress>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span>Visual: {data.queue.visual.running} running</span>
            <span>·</span>
            <span>{data.queue.visual.queued} queued</span>
            <span>·</span>
            <span>Orientation: {data.queue.orientation.running} running</span>
            <span>·</span>
            <span>{data.queue.orientation.queued} queued</span>
          </div>
          {unfinishedJobs.length ? (
            <div className="overflow-hidden rounded-lg border">
              <div className="max-h-[28rem] divide-y overflow-auto">
                {unfinishedJobs.map((job) => (
                  <div key={`${job.requestId}-${job.kind}`} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{job.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {jobKindLabel(job.kind)} · {job.fileName ?? job.requestId} · {jobTiming(job)}
                      </p>
                      {job.error && <p className="mt-1 text-xs text-destructive">{job.error}</p>}
                    </div>
                    <JobStatus status={job.status} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">All uploaded STL background jobs are complete.</p>
          )}
        </SettingsSection>
      )}
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

function JobStatus({ status }: { status: 'pending' | 'running' | 'ready' | 'skipped' | 'failed' }) {
  if (status === 'failed') return <Badge variant="destructive">Failed</Badge>
  if (status === 'running') return <Badge>Running</Badge>
  if (status === 'pending') return <Badge variant="secondary">Queued</Badge>
  if (status === 'skipped') return <Badge variant="outline">Not needed</Badge>
  return <Badge variant="outline">Complete</Badge>
}

function jobKindLabel(kind: 'thumbnail' | 'preview' | 'orientation') {
  if (kind === 'thumbnail') return 'Thumbnail'
  if (kind === 'preview') return 'Lightweight preview'
  return 'Orientation analysis'
}

function jobTiming(job: { status: string; queuedAt: number; startedAt?: number; finishedAt?: number }) {
  if (job.status === 'running' && job.startedAt) return `running for ${formatDuration(Date.now() - job.startedAt)}`
  if (job.status === 'failed' && job.finishedAt) return `failed ${relativeTime(job.finishedAt)}`
  if (job.status === 'pending') return `queued ${relativeTime(job.queuedAt)}`
  return job.finishedAt ? `completed ${relativeTime(job.finishedAt)}` : 'complete'
}

function relativeTime(timestamp: number) {
  const elapsed = Date.now() - timestamp
  if (elapsed < 60_000) return 'just now'
  return `${formatDuration(elapsed)} ago`
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(1, Math.round(milliseconds / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
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
