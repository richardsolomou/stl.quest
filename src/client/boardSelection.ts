import type { PublicPrintRequest } from '../core/types'
import type { StatusId } from '../core/workflow'

export type BoardSelection = {
  statuses: Map<string, StatusId>
  groupIds: Map<string, string>
  anchorId: string
  anchorStatus: StatusId
  anchorGroupId?: string
}
export type BoardSelectionEntry = { request: PublicPrintRequest; status: StatusId; groupId?: string; max: number }

export function boardSelectedCopies(entries: BoardSelectionEntry[], counts: Record<string, number> = {}) {
  return entries.map(({ request, status, groupId, max }) => ({ request, status, groupId, count: counts[request.id] ?? max }))
}

export function boardBatchMoves(entries: BoardSelectionEntry[], to: StatusId, counts: Record<string, number>) {
  return boardSelectedCopies(entries, counts).map(({ request, status: from, count }) => ({ id: request.id, from, to, count }))
}

export function boardBatchDeletions(entries: BoardSelectionEntry[]) {
  return boardSelectedCopies(entries).map(({ request, status, groupId, count }) => ({
    id: request.id,
    status,
    count,
    ...(groupId ? { groupId } : {}),
  }))
}

export function boardSelectionEntries(
  requests: PublicPrintRequest[],
  selection: BoardSelection | null,
  countsOf: (request: PublicPrintRequest) => PublicPrintRequest['counts'],
): BoardSelectionEntry[] {
  if (!selection) return []
  return requests.flatMap((request) => {
    const status = selection.statuses.get(request.id)
    if (!status) return []
    const groupId = selection.groupIds.get(request.id)
    const groupedEntry = groupId ? request.groups.find((group) => group.id === groupId) : undefined
    const available = groupedEntry?.count ?? countsOf(request)[status]
    if (available <= 0 || (groupId && !groupedEntry)) return []
    if (groupId) return [{ request, status, groupId, max: available }]
    const grouped = request.groups.filter((group) => group.status === status).reduce((sum, group) => sum + group.count, 0)
    const max = available - grouped
    return max > 0 ? [{ request, status, max }] : []
  })
}

export function selectBoardRequest(
  selection: BoardSelection | null,
  status: StatusId,
  orderedIds: string[],
  requestId: string,
  options: { range?: boolean; toggle?: boolean } = {},
  groupId?: string,
): BoardSelection | null {
  if (options.range && selection?.anchorStatus === status && selection.anchorGroupId === groupId) {
    const anchor = orderedIds.indexOf(selection.anchorId)
    const target = orderedIds.indexOf(requestId)
    if (anchor < 0 || target < 0) return selection
    const [start, end] = anchor < target ? [anchor, target] : [target, anchor]
    const range = new Set(orderedIds.slice(start, end + 1))
    const statuses = new Map(selection.statuses)
    const groupIds = new Map(selection.groupIds)
    for (const id of orderedIds) {
      if (statuses.get(id) === status && groupIds.get(id) === groupId) {
        statuses.delete(id)
        groupIds.delete(id)
      }
      if (range.has(id)) {
        statuses.set(id, status)
        if (groupId) groupIds.set(id, groupId)
      }
    }
    return { ...selection, statuses, groupIds }
  }
  if (options.toggle) {
    const statuses = new Map(selection?.statuses)
    const groupIds = new Map(selection?.groupIds)
    if (statuses.get(requestId) === status && groupIds.get(requestId) === groupId) {
      statuses.delete(requestId)
      groupIds.delete(requestId)
    } else {
      statuses.set(requestId, status)
      if (groupId) groupIds.set(requestId, groupId)
      else groupIds.delete(requestId)
    }
    return statuses.size ? { statuses, groupIds, anchorId: requestId, anchorStatus: status, anchorGroupId: groupId } : null
  }
  return {
    statuses: new Map([[requestId, status]]),
    groupIds: groupId ? new Map([[requestId, groupId]]) : new Map(),
    anchorId: requestId,
    anchorStatus: status,
    anchorGroupId: groupId,
  }
}
