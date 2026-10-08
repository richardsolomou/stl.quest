import { requesterQueuePriorities, type RequestQueueItem } from './requestQueue'
import type { StatusId, WorkflowStatus } from './workflow'

export type RequestStatusItem = RequestQueueItem & { counts: Record<string, number> }

export type RequestStageCount = { status: StatusId; label: string; count: number }

export type RequestStatusSummary<T extends RequestStatusItem> = {
  request: T
  stages: RequestStageCount[]
  /** One-based rank among the requester's own queued requests, using the board's requester-priority order. */
  queuePosition?: number
}

/** Furthest-along requests come first so finished prints waiting for pickup lead the list. */
export function requestStatusSummaries<T extends RequestStatusItem>(
  requests: T[],
  statuses: readonly WorkflowStatus[],
): RequestStatusSummary<T>[] {
  const queueStatus = statuses[0]?.id
  if (!queueStatus) return []
  const priorities = requesterQueuePriorities(
    requests.filter((request) => (request.counts[queueStatus] ?? 0) > 0),
    queueStatus,
  )
  const furthest = (stages: RequestStageCount[]) => Math.max(...stages.map((stage) => statuses.findIndex(({ id }) => id === stage.status)))
  return requests
    .map((request) => {
      const priority = priorities.get(request.id)
      return {
        request,
        stages: statuses.flatMap(({ id, label }) => {
          const count = request.counts[id] ?? 0
          return count > 0 ? [{ status: id, label, count }] : []
        }),
        ...(priority ? { queuePosition: priority.position + 1 } : {}),
      }
    })
    .filter((summary) => summary.stages.length > 0)
    .sort(
      (first, second) =>
        furthest(second.stages) - furthest(first.stages) ||
        (first.queuePosition ?? Infinity) - (second.queuePosition ?? Infinity) ||
        second.request.createdAt - first.request.createdAt ||
        first.request.id.localeCompare(second.request.id),
    )
}

export function requestStageTotals(
  summaries: Pick<RequestStatusSummary<RequestStatusItem>, 'stages'>[],
  statuses: readonly WorkflowStatus[],
) {
  return statuses.flatMap(({ id, label }) => {
    const count = summaries.reduce((sum, summary) => sum + (summary.stages.find((stage) => stage.status === id)?.count ?? 0), 0)
    return count > 0 ? [{ status: id, label, count }] : []
  })
}
