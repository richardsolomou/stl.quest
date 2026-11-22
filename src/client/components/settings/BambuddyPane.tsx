import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { attachPrintJob, setPrintJobPersonal } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { platesQuery, printJobsQuery, spoolmanQuery, type PlateView, type PrintJobView } from '../../queries'
import { invalidateQueries } from '../../queryState'
import { REPOSITORY_URL } from '../../sourceCode'
import { useUsageTracking, useWorkspaceSlug } from '../../workspace'
import { CopyableValue } from '../CopyableValue'
import { QueryState } from '../QueryState'
import { SettingNotice, errorNotice } from '../SettingNotice'
import { AppLogo } from '../AppLogo'
import { SettingRow } from '../SettingRow'
import { UsageTrackingInvite } from '../UsageTracking'
import { PageHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const DOCS_URL = `${REPOSITORY_URL}/blob/main/docs/bambuddy.md`
const RECENT = 20

/** Bambuddy's webhook setup, the prints that found no plate, and what it reported lately. */
export function BambuddyPane() {
  const workspaceSlug = useWorkspaceSlug()
  const { t } = useI18n()
  const copy = t.settings.bambuddy
  const tracking = useUsageTracking()
  const spoolman = useQuery(spoolmanQuery(workspaceSlug))
  const jobs = useQuery({ ...printJobsQuery(workspaceSlug), enabled: tracking })
  if (!spoolman.data) {
    return (
      <SettingsPage>
        <PageHeader title={copy.title} description={copy.description} />
        <QueryState
          loading={spoolman.isPending}
          error={spoolman.error}
          loadingLabel={copy.loading}
          errorTitle={copy.loadError}
          onRetry={() => void spoolman.refetch()}
        />
      </SettingsPage>
    )
  }
  const latest = jobs.data?.jobs[0]
  return (
    <SettingsPage>
      <PageHeader title={copy.title} description={copy.description} />
      {!tracking && <UsageTrackingInvite source="bambuddy" line={t.settings.board.tracking.invite.bambuddy} />}
      <Connect connected={Boolean(spoolman.data.connection)} printsUrl={spoolman.data.printsUrl} lastReceivedAt={latest?.receivedAt} />
      {tracking && jobs.data && <Prints workspaceSlug={workspaceSlug} jobs={jobs.data.jobs} />}
      {tracking && !jobs.data && (
        <QueryState
          loading={jobs.isPending}
          error={jobs.error}
          loadingLabel={copy.loading}
          errorTitle={copy.loadError}
          onRetry={() => void jobs.refetch()}
        />
      )}
    </SettingsPage>
  )
}

function Connect({ connected, printsUrl, lastReceivedAt }: { connected: boolean; printsUrl: string; lastReceivedAt?: number }) {
  const { t, locale } = useI18n()
  const copy = t.settings.bambuddy.connect
  const status = t.settings.spoolman.connection.status
  const when = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <SettingsSection title={copy.title} description={copy.description}>
      <div className="grid gap-4">
        <SettingRow
          icon={<AppLogo app="bambuddy" className="size-6" />}
          name={t.settings.bambuddy.title}
          status={
            !connected
              ? { label: status.off, tone: 'off' }
              : lastReceivedAt
                ? { label: status.receiving, tone: 'on' }
                : { label: status.waiting, tone: 'ready' }
          }
          detail={!connected ? copy.needsToken : lastReceivedAt ? copy.last(when.format(lastReceivedAt)) : copy.none}
          actions={
            !connected && (
              <Button size="sm" variant="outline" render={<Link to="/settings/$section" params={{ section: 'spoolman' }} />}>
                {copy.tokenLink}
              </Button>
            )
          }
        />
        {connected && (
          <>
            <ol className="grid list-decimal gap-1.5 pl-5 text-sm leading-relaxed">
              {copy.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <CopyableValue label={copy.url} value={printsUrl} description={copy.urlHint} />
            <a href={DOCS_URL} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-2">
              {copy.docs}
            </a>
          </>
        )}
      </div>
    </SettingsSection>
  )
}

function Prints({ workspaceSlug, jobs }: { workspaceSlug: string; jobs: PrintJobView[] }) {
  const copy = useI18n().t.settings.bambuddy
  const plates = useQuery(platesQuery(workspaceSlug)).data?.plates ?? []
  const queryClient = useQueryClient()
  const refresh = () => invalidateQueries(queryClient, 'print-jobs', 'plates', 'requests', 'usage', 'printer-lifetimes')
  const attach = useMutation({ mutationFn: useServerFn(attachPrintJob), onSuccess: refresh })
  const personal = useMutation({ mutationFn: useServerFn(setPrintJobPersonal), onSuccess: refresh })
  const pending = attach.isPending || personal.isPending
  const unlinked = jobs.filter((job) => !job.plateId && !job.personal && job.outcome !== 'printing')
  const error = attach.error ?? personal.error
  return (
    <>
      <SettingsSection title={copy.unlinked.title} description={copy.unlinked.description} layout="stacked">
        {unlinked.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.unlinked.empty}</p>
        ) : (
          <ul className="grid divide-y" aria-label={copy.unlinked.title}>
            {unlinked.map((job) => (
              <li key={job.id} className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <PrintSummary job={job} />
                <div className="flex flex-wrap items-center gap-2">
                  {job.suggested && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      title={job.suggested.name}
                      onClick={() => attach.mutate({ data: { workspaceSlug, jobId: job.id, requestId: job.suggested!.requestId } })}
                    >
                      {copy.unlinked.attachTag(job.suggested.tag)}
                    </Button>
                  )}
                  {plates.length > 0 && (
                    <PlatePicker
                      plates={plates}
                      disabled={pending}
                      onChoose={(plateId) => attach.mutate({ data: { workspaceSlug, jobId: job.id, plateId } })}
                    />
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => personal.mutate({ data: { workspaceSlug, jobId: job.id, personal: true } })}
                  >
                    {copy.unlinked.personal}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {error != null && <SettingNotice notice={errorNotice(copy.unlinked.error, '', error)} />}
      </SettingsSection>
      <SettingsSection title={copy.recent.title} description={copy.recent.description} layout="stacked">
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.recent.empty}</p>
        ) : (
          <ul className="grid divide-y" aria-label={copy.recent.title}>
            {jobs.slice(0, RECENT).map((job) => {
              const plate = plates.find(({ id }) => id === job.plateId)
              return (
                <li key={job.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                  <PrintSummary job={job} />
                  <span className="ml-auto flex items-center gap-2 font-mono text-xs text-muted-foreground uppercase">
                    {plate ? copy.recent.onPlate(plate.number) : job.personal ? copy.recent.personal : copy.recent.unlinked}
                    {job.personal && (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => personal.mutate({ data: { workspaceSlug, jobId: job.id, personal: false } })}
                      >
                        {copy.unlinked.notPersonal}
                      </Button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </SettingsSection>
    </>
  )
}

/** A print as Bambuddy named it, with its printer, outcome, and what it measured. */
function PrintSummary({ job }: { job: PrintJobView }) {
  const { t, locale } = useI18n()
  const copy = t.settings.bambuddy
  const when = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const failed = job.outcome === 'failed' || job.outcome === 'cancelled'
  const detail = [
    job.printerId ? job.printerName : copy.unknownPrinter(job.printerName),
    job.minutes !== undefined && `${number.format(job.minutes / 60)} h`,
    job.grams !== undefined && `${number.format(job.grams)} g`,
    when.format(job.endedAt ?? job.receivedAt),
  ].filter(Boolean)
  return (
    <div className="min-w-0">
      <p className="font-semibold [overflow-wrap:anywhere]">
        {job.fileName ?? copy.untitled}{' '}
        <span className={cn('font-mono text-xs font-normal uppercase', failed ? 'text-destructive' : 'text-muted-foreground')}>
          · {t.plates.outcome[job.outcome]}
        </span>
      </p>
      <p className="text-sm text-muted-foreground">{detail.join(' · ')}</p>
    </div>
  )
}

function PlatePicker({ plates, disabled, onChoose }: { plates: PlateView[]; disabled: boolean; onChoose: (plateId: string) => void }) {
  const { t } = useI18n()
  const options = plates
    .slice(0, 50)
    .map((plate) => ({ value: plate.id, label: `${t.plates.name(plate.number)} · ${t.plates.station(plate.items.length)}` }))
  return (
    <Select items={options} value={null} disabled={disabled} onValueChange={(value) => value && onChoose(value)}>
      <SelectTrigger size="sm" className="w-48" aria-label={t.settings.bambuddy.unlinked.attachTo}>
        <SelectValue placeholder={t.settings.bambuddy.unlinked.attachTo} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
