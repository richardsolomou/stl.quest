import type { PrintGroup, PublicPrintRequest } from '../core/types'
import type { StatusId, WorkflowDefinition } from '../core/workflow'
import { requesterQueuePriorities } from '../core/requestQueue'
import { boardRequestState, type BoardOverride } from './boardOverrides'

export type BoardStatusEntries = {
  entries: BoardRequestEntry[]
  total: number
}

export type BoardRequestEntry = { request: PublicPrintRequest; count: number; key: string; groupId?: string }

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
  selectedTagIds?: Set<string>,
) {
  return new Map(
    statuses.map((definition) => {
      const status = definition.id
      const entries = requests
        .flatMap((request) => boardRequestCohorts({ ...request, groups: groupsOf(request) }, status, countsOf(request)[status]))
        .filter(({ request }) => !selectedTagIds || request.groups.some((group) => selectedTagIds.has(group.id)))
        .filter(({ count }) => count > 0)
        .sort((left, right) => compare(left.request, right.request, status) || left.key.localeCompare(right.key))
      return [status, { entries, total: entries.reduce((sum, entry) => sum + entry.count, 0) }] as const
    }),
  )
}

export function boardRequestCohorts(request: PublicPrintRequest, status: StatusId, count: number): BoardRequestEntry[] {
  type Cohort = { count: number; groups: PublicPrintRequest['groups'] }
  let cohorts: Cohort[] = count > 0 ? [{ count, groups: [] }] : []
  for (const group of request.groups.filter((candidate) => candidate.status === status)) {
    let remaining = Math.min(group.count, count)
    const withoutTag = cohorts.filter((cohort) => !cohort.groups.some((candidate) => candidate.id === group.id))
    withoutTag.sort((left, right) => left.groups.length - right.groups.length)
    for (const cohort of withoutTag) {
      if (remaining === 0) break
      const assigned = Math.min(remaining, cohort.count)
      remaining -= assigned
      if (assigned === cohort.count) cohort.groups = [...cohort.groups, group]
      else {
        cohort.count -= assigned
        cohorts.push({ count: assigned, groups: [...cohort.groups, group] })
      }
    }
  }
  cohorts = cohorts.filter(({ count: cohortCount }) => cohortCount > 0)
  return cohorts.map((cohort) => {
    const ids = cohort.groups.map(({ id }) => id).sort()
    return {
      request: { ...request, groups: cohort.groups },
      count: cohort.count,
      key: `${request.id}:${status}:${ids.join(',') || 'untagged'}`,
      ...(ids.length === 1 ? { groupId: ids[0] } : {}),
    }
  })
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
