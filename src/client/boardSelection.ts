import type { PublicPrintRequest } from '../core/types'
import type { StatusId } from '../core/workflow'

export type BoardSelection = {
  statuses: Map<string, StatusId>
  groupId?: string
  anchorId: string
  anchorStatus: StatusId
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
    const groupedEntry = selection.groupId ? request.groups.find((group) => group.id === selection.groupId) : undefined
    const available = groupedEntry?.count ?? countsOf(request)[status]
    if (available <= 0 || (selection.groupId && !groupedEntry)) return []
    if (selection.groupId) return [{ request, status, groupId: selection.groupId, max: available }]
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
  if (selection?.groupId !== groupId)
    return { statuses: new Map([[requestId, status]]), groupId, anchorId: requestId, anchorStatus: status }
  if (options.range && selection?.anchorStatus === status) {
    const anchor = orderedIds.indexOf(selection.anchorId)
    const target = orderedIds.indexOf(requestId)
    if (anchor < 0 || target < 0) return selection
    const [start, end] = anchor < target ? [anchor, target] : [target, anchor]
    const statuses = new Map([...selection.statuses].filter(([, selectedStatus]) => selectedStatus !== status))
    for (const id of orderedIds.slice(start, end + 1)) statuses.set(id, status)
    return { ...selection, statuses }
  }
  if (options.toggle) {
    const statuses = new Map(selection?.statuses)
    if (statuses.get(requestId) === status) statuses.delete(requestId)
    else statuses.set(requestId, status)
    return statuses.size ? { statuses, groupId, anchorId: requestId, anchorStatus: status } : null
  }
  return { statuses: new Map([[requestId, status]]), groupId, anchorId: requestId, anchorStatus: status }
}
