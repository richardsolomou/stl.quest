import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePostHog } from '@posthog/react'
import { ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { requestStageTotals, requestStatusSummaries } from '../../core/requestStatus'
import type { WorkflowDefinition } from '../../core/workflow'
import { requestsQuery } from '../queries'
import { retryQueries } from '../queryState'
import { printEstimateSummary } from './PrintEstimate'
import { QueryState } from './QueryState'
import { RequestThumb } from './RequestThumb'
import { StatusDot } from './StatusDot'
import { useI18n } from '../i18n'
import { statusText } from '../../core/i18n'

export function MyRequests({
  workspaceSlug,
  userId,
  workflow,
  onOpenRequest,
}: {
  workspaceSlug: string
  userId: string
  workflow: WorkflowDefinition
  onOpenRequest: (requestId: string) => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  const posthog = usePostHog()
  const [open, setOpen] = useState(false)
  const result = useQuery({ ...requestsQuery(workspaceSlug, { requester: userId }), enabled: open })
  const summaries = useMemo(() => requestStatusSummaries(result.data?.requests ?? [], workflow.statuses), [result.data, workflow.statuses])
  const totals = requestStageTotals(summaries, workflow.statuses)
  const loaded = result.data !== undefined

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) posthog.capture('my_requests_opened')
        setOpen(next)
      }}
    >
      <PopoverTrigger render={<Button type="button" variant="outline" />}>
        <ListChecks />
        <span className="max-sm:sr-only">{t.requests.myRequests.title}</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-[min(32rem,var(--available-height))] w-[min(420px,calc(100vw-24px))] gap-0 p-0"
      >
        <PopoverHeader className="gap-2 border-b-2 border-dashed border-blueprint/25 p-3">
          <PopoverTitle className="font-heading text-xs font-semibold tracking-[0.08em] uppercase">
            {t.requests.myRequests.title}
          </PopoverTitle>
          {loaded && totals.length > 0 ? (
            <PopoverDescription render={<ul aria-label={t.requests.myRequests.copiesByStage} />} className="flex flex-wrap gap-1.5">
              {totals.map((total) => (
                <li key={total.status} className="flex items-center gap-1.5 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-foreground">
                  <StatusDot status={total.status} />
                  {statusText(t, 'label', total.status)}
                  <span className="font-mono text-[10px] text-muted-foreground">{total.count}</span>
                </li>
              ))}
            </PopoverDescription>
          ) : (
            <PopoverDescription>{loaded ? t.requests.myRequests.empty : t.requests.myRequests.intro}</PopoverDescription>
          )}
        </PopoverHeader>
        {!loaded ? (
          <QueryState
            loading={result.isPending}
            error={result.error}
            loadingLabel={t.requests.myRequests.loading}
            errorTitle={t.requests.myRequests.loadFailed}
            onRetry={() => void retryQueries(result.refetch)}
            className="m-3 w-auto"
          />
        ) : (
          summaries.length > 0 && (
            <ul
              aria-label={t.requests.myRequests.title}
              className="app-scrollbar grid min-h-0 gap-2 overflow-y-auto overscroll-contain p-2"
            >
              {summaries.map(({ request, stages, ranks }) => {
                const estimate = printEstimateSummary(request, i18n)
                return (
                  <li key={request.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-lg border-2 border-transparent bg-ticket p-2 text-left text-ticket-foreground shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-colors hover:border-blueprint/40 focus-visible:border-ring focus-visible:outline-none"
                      onClick={() => {
                        setOpen(false)
                        onOpenRequest(request.id)
                      }}
                    >
                      <span className="relative size-12 shrink-0">
                        <RequestThumb request={request} />
                      </span>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="ph-no-capture truncate font-serif text-base font-semibold leading-snug">{request.name}</span>
                        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ticket-muted">
                          {stages.map((stage) => {
                            const rank = ranks.find((candidate) => candidate.status === stage.status)
                            const rankLabel = workflow.statuses.find(({ id }) => id === stage.status)?.rankLabel
                              ? statusText(t, 'rankLabel', stage.status)
                              : undefined
                            return (
                              <span key={stage.status} className="flex items-center gap-1.5">
                                <StatusDot status={stage.status} />
                                {rank && rankLabel ? (
                                  <span>
                                    <span className="text-ticket-foreground">{t.requests.myRequests.rankPosition(rank.position)}</span>{' '}
                                    {t.requests.myRequests.rankOf(rank.total, rankLabel)}
                                    {stage.count > 1 && <span className="font-mono text-ticket-foreground"> ×{stage.count}</span>}
                                  </span>
                                ) : (
                                  <span>
                                    {statusText(t, 'label', stage.status)}{' '}
                                    <span className="font-mono text-ticket-foreground">{stage.count}</span>
                                  </span>
                                )}
                              </span>
                            )
                          })}
                        </span>
                        {estimate && <span className="font-mono text-xs text-ticket-muted">{t.requests.myRequests.perCopy(estimate)}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        )}
      </PopoverContent>
    </Popover>
  )
}
