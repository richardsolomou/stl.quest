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
  const posthog = usePostHog()
  const [open, setOpen] = useState(false)
  const result = useQuery({ ...requestsQuery(workspaceSlug, { requester: userId }), enabled: open })
  const summaries = useMemo(() => requestStatusSummaries(result.data?.requests ?? [], workflow.statuses), [result.data, workflow.statuses])
  const totals = requestStageTotals(summaries, workflow.statuses)
  const queued = summaries.filter((summary) => summary.queuePosition !== undefined).length
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
        <span className="max-sm:sr-only">My requests</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-[min(32rem,var(--available-height))] w-[min(420px,calc(100vw-24px))] gap-0 p-0"
      >
        <PopoverHeader className="border-b-2 border-dashed border-blueprint/25 p-3">
          <PopoverTitle>My requests</PopoverTitle>
          <PopoverDescription>
            {!loaded
              ? 'Where each of your prints is right now.'
              : totals.length
                ? totals.map((total) => `${total.label} ${total.count}`).join(' · ')
                : 'You have no prints on the board.'}
          </PopoverDescription>
        </PopoverHeader>
        {!loaded ? (
          <QueryState
            loading={result.isPending}
            error={result.error}
            loadingLabel="Loading your requests…"
            errorTitle="Could not load your requests"
            onRetry={() => void retryQueries(result.refetch)}
            className="m-3 w-auto"
          />
        ) : (
          summaries.length > 0 && (
            <ul aria-label="My requests" className="app-scrollbar min-h-0 overflow-y-auto overscroll-contain p-1.5">
              {summaries.map(({ request, stages, queuePosition }) => {
                const estimate = printEstimateSummary(request)
                return (
                  <li key={request.id}>
                    <button
                      type="button"
                      className="grid w-full gap-1 rounded-md p-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      onClick={() => {
                        setOpen(false)
                        onOpenRequest(request.id)
                      }}
                    >
                      <span className="ph-no-capture truncate font-medium">{request.name}</span>
                      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {stages.map((stage) => (
                          <span key={stage.status}>
                            {stage.label} <span className="font-mono text-foreground">{stage.count}</span>
                          </span>
                        ))}
                        {queuePosition !== undefined && (
                          <span>
                            #{queuePosition} of {queued} in your queue
                          </span>
                        )}
                      </span>
                      {estimate && <span className="font-mono text-xs text-muted-foreground">{estimate} per copy</span>}
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
