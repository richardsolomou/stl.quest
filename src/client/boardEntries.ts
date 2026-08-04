import type { PrintGroup, PublicPrintRequest } from '../core/types'
import type { StatusId, WorkflowDefinition } from '../core/workflow'
import { requesterQueuePriorities } from '../core/requestQueue'
import { boardRequestState, type BoardOverride } from './boardOverrides'

export type BoardStatusEntries = {
  entries: Array<{ request: PublicPrintRequest; count: number }>
  total: number
}

export type BoardGroupEntries = {
  group: PrintGroup
  items: Array<{ request: PublicPrintRequest; count: number }>
}

export function boardTagCopyCounts(groups: PrintGroup[]) {
  return new Map(
    groups.flatMap((group) => {
      const counts = new Map<StatusId, number>()
      for (const item of group.items) counts.set(item.status, (counts.get(item.status) ?? 0) + item.count)
      return [...counts].map(([status, count]) => [`${status}:${group.id}`, count] as const)
    }),
  )
}

export function boardEntriesByStatus(
  requests: PublicPrintRequest[],
  groups: PrintGroup[],
  statuses: readonly WorkflowDefinition['statuses'][number][],
  countsOf: (request: PublicPrintRequest) => PublicPrintRequest['counts'],
  groupsOf: (request: PublicPrintRequest) => PublicPrintRequest['groups'],
  compare: (left: PublicPrintRequest, right: PublicPrintRequest, status: StatusId) => number,
) {
  return new Map(
    statuses.map((definition) => {
      const status = definition.id
      const entries = requests
        .map((request) => ({
          request: { ...request, groups: groupsOf(request) },
          count: countsOf(request)[status],
        }))
        .filter(({ count }) => count > 0)
        .sort((left, right) => compare(left.request, right.request, status))
      return [status, { entries, total: entries.reduce((sum, entry) => sum + entry.count, 0) }] as const
    }),
  )
}

export function boardGroupsByStatus(requests: PublicPrintRequest[], groups: PrintGroup[]) {
  const requestsById = new Map(requests.map((request) => [request.id, request]))
  const result = new Map<StatusId, BoardGroupEntries[]>()
  for (const group of groups) {
    const statuses = new Set(group.items.map((item) => item.status))
    if (group.items.length === 0) statuses.add(group.status)
    for (const status of statuses) {
      const entries = result.get(status) ?? []
      entries.push({
        group,
        items: group.items.flatMap((item) => {
          const request = requestsById.get(item.requestId)
          return item.status === status && request ? [{ request, count: item.count }] : []
        }),
      })
      result.set(status, entries)
    }
  }
  return result
}

export function boardPrioritiesByStatus(
  requests: PublicPrintRequest[],
  statuses: readonly WorkflowDefinition['statuses'][number][],
  overrides: Record<string, BoardOverride>,
) {
  const current = requests.map((request) => ({ ...request, ...boardRequestState(request, overrides[request.id]) }))
  return new Map(
    statuses.map((status) => [
      status.id,
      requesterQueuePriorities(
        current.filter((request) => request.counts[status.id] > 0),
        status.id,
      ),
    ]),
  )
}
