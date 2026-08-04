import type { PublicPrintRequest } from '../core/types'
import type { StatusId } from '../core/workflow'

export type BoardSelection = {
  statuses: Map<string, StatusId>
  groupIds: Map<string, string>
  requestIds: Map<string, string>
  anchorId: string
  anchorStatus: StatusId
  anchorGroupId?: string
}
export type BoardSelectionEntry = { request: PublicPrintRequest; status: StatusId; groupId?: string; max: number }

export function boardCohortId(requestId: string, status: StatusId, groupId?: string) {
  return `${requestId}:${status}:${groupId ?? 'untagged'}`
}

export function boardSelectedCopies(entries: BoardSelectionEntry[], counts: Record<string, number> = {}) {
  return entries.map(({ request, status, groupId, max }) => ({ request, status, groupId, count: counts[request.id] ?? max }))
}

export function boardSelectedRequestIds(selection: BoardSelection | null, status?: StatusId) {
  return new Set(
    [...(selection?.statuses ?? [])]
      .filter(([, selectedStatus]) => status === undefined || selectedStatus === status)
      .filter(([selectionId]) => !selection?.groupIds.has(selectionId))
      .map(([selectionId]) => selection!.requestIds.get(selectionId)!),
  )
}

export function boardSelectedCardIds(selection: BoardSelection | null, status?: StatusId) {
  return new Set(
    [...(selection?.statuses ?? [])]
      .filter(([, selectedStatus]) => status === undefined || selectedStatus === status)
      .map(([selectionId]) => selectionId),
  )
}

export function boardRequestSelected(selection: BoardSelection | null, status: StatusId, requestId: string, groupId?: string) {
  const selectionId = boardCohortId(requestId, status, groupId)
  return selection?.statuses.get(selectionId) === status && selection.groupIds.get(selectionId) === groupId
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
  return [...selection.statuses].flatMap(([selectionId, status]) => {
    const request = requests.find((candidate) => candidate.id === selection.requestIds.get(selectionId))
    if (!request) return []
    const groupId = selection.groupIds.get(selectionId)
    const groupedEntry = groupId ? request.groups.find((group) => group.id === groupId) : undefined
    const available = groupedEntry?.count ?? countsOf(request)[status]
    if (available <= 0 || (groupId && !groupedEntry)) return []
    if (groupId) return [{ request, status, groupId, max: available }]
    return [{ request, status, max: available }]
  })
}

export function selectBoardTag(requests: PublicPrintRequest[], status: StatusId, tagId: string): BoardSelection | null {
  const entries = requests
    .filter((request) => request.groups.some((group) => group.id === tagId && group.status === status))
    .map((request) => ({ requestId: request.id, selectionId: boardCohortId(request.id, status, tagId) }))
  if (entries.length === 0) return null
  return {
    statuses: new Map(entries.map(({ selectionId }) => [selectionId, status])),
    groupIds: new Map(entries.map(({ selectionId }) => [selectionId, tagId])),
    requestIds: new Map(entries.map(({ selectionId, requestId }) => [selectionId, requestId])),
    anchorId: entries[0].selectionId,
    anchorStatus: status,
    anchorGroupId: tagId,
  }
}

export function selectBoardRequest(
  selection: BoardSelection | null,
  status: StatusId,
  orderedIds: string[],
  requestId: string,
  options: { range?: boolean; toggle?: boolean } = {},
  groupId?: string,
): BoardSelection | null {
  const selectionId = boardCohortId(requestId, status, groupId)
  const orderedSelectionIds = orderedIds.map((id) => boardCohortId(id, status, groupId))
  if (options.range && selection?.anchorStatus === status && selection.anchorGroupId === groupId) {
    const anchor = orderedSelectionIds.indexOf(selection.anchorId)
    const target = orderedSelectionIds.indexOf(selectionId)
    if (anchor < 0 || target < 0) return selection
    const [start, end] = anchor < target ? [anchor, target] : [target, anchor]
    const range = new Set(orderedSelectionIds.slice(start, end + 1))
    const statuses = new Map(selection.statuses)
    const groupIds = new Map(selection.groupIds)
    const requestIds = new Map(selection.requestIds)
    for (const [index, id] of orderedSelectionIds.entries()) {
      if (statuses.get(id) === status && groupIds.get(id) === groupId) {
        statuses.delete(id)
        groupIds.delete(id)
        requestIds.delete(id)
      }
      if (range.has(id)) {
        statuses.set(id, status)
        requestIds.set(id, orderedIds[index])
        if (groupId) groupIds.set(id, groupId)
      }
    }
    return { ...selection, statuses, groupIds, requestIds }
  }
  if (options.toggle) {
    const statuses = new Map(selection?.statuses)
    const groupIds = new Map(selection?.groupIds)
    const requestIds = new Map(selection?.requestIds)
    if (statuses.get(selectionId) === status && groupIds.get(selectionId) === groupId) {
      statuses.delete(selectionId)
      groupIds.delete(selectionId)
      requestIds.delete(selectionId)
    } else {
      statuses.set(selectionId, status)
      requestIds.set(selectionId, requestId)
      if (groupId) groupIds.set(selectionId, groupId)
      else groupIds.delete(selectionId)
    }
    return statuses.size ? { statuses, groupIds, requestIds, anchorId: selectionId, anchorStatus: status, anchorGroupId: groupId } : null
  }
  return {
    statuses: new Map([[selectionId, status]]),
    groupIds: groupId ? new Map([[selectionId, groupId]]) : new Map(),
    requestIds: new Map([[selectionId, requestId]]),
    anchorId: selectionId,
    anchorStatus: status,
    anchorGroupId: groupId,
  }
}
