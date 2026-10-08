import { requesterQueuePriorities, type RequestQueueItem } from './requestQueue'
import type { StatusId, WorkflowStatus } from './workflow'

export type RequestStatusItem = RequestQueueItem & { counts: Record<string, number> }

export type RequestStageCount = { status: StatusId; label: string; count: number }

export type RequestStageRank = { status: StatusId; position: number; total: number }

export type RequestStatusSummary<T extends RequestStatusItem> = {
  request: T
  stages: RequestStageCount[]
  /** One-based rank among the requester's own requests in each waiting stage, using the board's requester-priority order. */
  ranks: RequestStageRank[]
}

/** Stages whose order the requester controls; later stages run in whatever order the operator works them. */
const RANKED_STATUSES: ReadonlySet<StatusId> = new Set(['todo', 'up_next'])

/** Furthest-along requests come first so finished prints waiting for pickup lead the list. */
export function requestStatusSummaries<T extends RequestStatusItem>(
  requests: T[],
  statuses: readonly WorkflowStatus[],
): RequestStatusSummary<T>[] {
  const rankings = statuses
    .filter(({ id }) => RANKED_STATUSES.has(id))
    .map(({ id }) => {
      const waiting = requests.filter((request) => (request.counts[id] ?? 0) > 0)
      return { status: id, total: waiting.length, priorities: requesterQueuePriorities(waiting, id) }
    })
  const stageIndex = (status: StatusId) => statuses.findIndex(({ id }) => id === status)
  const furthest = (summary: RequestStatusSummary<T>) => summary.stages.at(-1)?.status
  const furthestRank = (summary: RequestStatusSummary<T>) =>
    summary.ranks.find((rank) => rank.status === furthest(summary))?.position ?? Infinity
  return requests
    .map((request) => ({
      request,
      stages: statuses.flatMap(({ id, label }) => {
        const count = request.counts[id] ?? 0
        return count > 0 ? [{ status: id, label, count }] : []
      }),
      ranks: rankings.flatMap(({ status, total, priorities }) => {
        const priority = priorities.get(request.id)
        return priority ? [{ status, position: priority.position + 1, total }] : []
      }),
    }))
    .filter((summary) => summary.stages.length > 0)
    .sort(
      (first, second) =>
        stageIndex(furthest(second) ?? '') - stageIndex(furthest(first) ?? '') ||
        furthestRank(first) - furthestRank(second) ||
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
