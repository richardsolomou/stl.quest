import { useQuery } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress'
import { formatBytes } from '../../../core/format'
import type { Messages } from '../../../core/i18n'
import { diagnosticsQuery } from '../../queries'
import { storageRecoveryHint } from '../../storageProviders'
import { useWorkspaceSlug } from '../../workspace'
import { QueryState } from '../QueryState'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { useI18n } from '../../i18n'

type DiagnosticsCopy = Messages['settings']['diagnostics']

export function DiagnosticsPane({ embedded = false }: { embedded?: boolean }) {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(diagnosticsQuery(workspaceSlug))
  const data = query.data
  const backgroundJobs = data?.backgroundJobs ?? []
  const unfinishedJobs = backgroundJobs.filter((job) => !['ready', 'skipped'].includes(job.status))
  const { t, locale } = useI18n()
  const copy = t.settings.diagnostics
  const content = (
    <>
      <SettingsSection title={embedded ? copy.embeddedTitle : undefined}>
        {!data && (
          <QueryState
            loading={query.isPending}
            error={query.error}
            loadingLabel={copy.loading}
            errorTitle={copy.loadError}
            onRetry={() => void query.refetch()}
          />
        )}
        {data && (
          <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-4 gap-y-2.5 max-sm:grid-cols-1 [&_dt]:text-muted-foreground [&_dd]:m-0">
            <dt>{copy.storage}</dt>
            <dd>
              {data.storage} · {data.storageReady ? copy.ready : copy.unavailable}
            </dd>
            <dt>{copy.assetQueue}</dt>
            <dd>{copy.queueSummary(data.queue.queued, data.queue.pending)}</dd>
            <dt>{copy.incompleteUploads}</dt>
            <dd>
              {data.incompleteUploads.count} · {formatBytes(data.incompleteUploads.bytes, locale)}
            </dd>
            <dt>{copy.diskFree}</dt>
            <dd>
              {data.storageCapacity
                ? formatBytes(data.storageCapacity.freeBytes, locale)
                : data.storage === 'local'
                  ? copy.unavailable
                  : copy.notApplicable}
            </dd>
          </dl>
        )}
        {data && !data.storageReady && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>{copy.storageUnavailable}</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <span>{storageRecoveryHint(t.storage, data.storage)}</span>
              {data.storageError && <span className="text-xs break-words opacity-80">{data.storageError}</span>}
            </AlertDescription>
          </Alert>
        )}
      </SettingsSection>
      {data && (
        <SettingsSection title={copy.jobs.title} description={copy.jobs.description}>
          <div className="grid gap-3 md:grid-cols-2">
            {(['geometry', 'thumbnail', 'preview'] as const).map((kind) => {
              const jobs = backgroundJobs.filter((job) => job.kind === kind)
              const complete = jobs.filter((job) => job.status === 'ready' || job.status === 'skipped').length
              return (
                <Progress key={kind} value={jobs.length ? (complete / jobs.length) * 100 : 100}>
                  <ProgressLabel>{copy.jobs.kind[kind]}</ProgressLabel>
                  <ProgressValue>{() => (jobs.length ? `${complete}/${jobs.length}` : copy.jobs.none)}</ProgressValue>
                </Progress>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span>{copy.jobs.visualRunning(data.queue.visual.running)}</span>
            <span>·</span>
            <span>{copy.jobs.queued(data.queue.visual.queued)}</span>
          </div>
          {unfinishedJobs.length ? (
            <div className="overflow-hidden rounded-lg border">
              <div className="max-h-[28rem] divide-y overflow-auto">
                {unfinishedJobs.map((job) => (
                  <div key={`${job.requestId}-${job.kind}`} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{job.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {copy.jobs.kind[job.kind]} · {job.fileName ?? job.requestId} · {jobTiming(copy, job)}
                      </p>
                      {job.error && <p className="mt-1 text-xs text-destructive">{job.error}</p>}
                    </div>
                    <JobStatus status={job.status} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{copy.jobs.allComplete}</p>
          )}
        </SettingsSection>
      )}
    </>
  )
  if (embedded) return content
  return (
    <SettingsPage>
      <SettingsHeader title={copy.title} description={copy.description} />
      {content}
    </SettingsPage>
  )
}

function JobStatus({ status }: { status: 'pending' | 'running' | 'ready' | 'skipped' | 'failed' }) {
  const copy = useI18n().t.settings.diagnostics.jobs.status
  if (status === 'failed') return <Badge variant="destructive">{copy.failed}</Badge>
  if (status === 'running') return <Badge>{copy.running}</Badge>
  if (status === 'pending') return <Badge variant="secondary">{copy.pending}</Badge>
  if (status === 'skipped') return <Badge variant="outline">{copy.skipped}</Badge>
  return <Badge variant="outline">{copy.ready}</Badge>
}

function jobTiming(copy: DiagnosticsCopy, job: { status: string; queuedAt: number; startedAt?: number; finishedAt?: number }) {
  const timing = copy.jobs.timing
  if (job.status === 'running' && job.startedAt) return timing.runningFor(formatDuration(Date.now() - job.startedAt))
  if (job.status === 'failed' && job.finishedAt) return timing.failed(relativeTime(copy, job.finishedAt))
  if (job.status === 'pending') return timing.queued(relativeTime(copy, job.queuedAt))
  return job.finishedAt ? timing.completed(relativeTime(copy, job.finishedAt)) : timing.complete
}

function relativeTime(copy: DiagnosticsCopy, timestamp: number) {
  const elapsed = Date.now() - timestamp
  if (elapsed < 60_000) return copy.jobs.timing.justNow
  return copy.jobs.timing.ago(formatDuration(elapsed))
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(1, Math.round(milliseconds / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
}
