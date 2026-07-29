import type { PublicPrintRequest } from '../core/types'
import type { StatusId } from '../core/workflow'

export type BoardSelection = { status: StatusId; ids: Set<string>; anchorId: string }
export type BoardSelectionEntry = { request: PublicPrintRequest; max: number }

export function boardSelectionEntries(
  requests: PublicPrintRequest[],
  selection: BoardSelection | null,
  countsOf: (request: PublicPrintRequest) => PublicPrintRequest['counts'],
): BoardSelectionEntry[] {
  if (!selection) return []
  return requests.flatMap((request) => {
    if (!selection.ids.has(request.id)) return []
    const available = countsOf(request)[selection.status]
    if (available <= 0) return []
    const grouped = request.groups.filter((group) => group.status === selection.status).reduce((sum, group) => sum + group.count, 0)
    const max = available - grouped
    return max > 0 ? [{ request, max }] : []
  })
}

export function selectBoardRequest(
  selection: BoardSelection | null,
  status: StatusId,
  orderedIds: string[],
  requestId: string,
  options: { range?: boolean; toggle?: boolean } = {},
): BoardSelection | null {
  if (selection?.status !== status) return { status, ids: new Set([requestId]), anchorId: requestId }
  if (options.range) {
    const anchor = orderedIds.indexOf(selection.anchorId)
    const target = orderedIds.indexOf(requestId)
    if (anchor < 0 || target < 0) return selection
    const [start, end] = anchor < target ? [anchor, target] : [target, anchor]
    return { ...selection, ids: new Set(orderedIds.slice(start, end + 1)) }
  }
  if (options.toggle) {
    const ids = new Set(selection.ids)
    if (ids.has(requestId)) ids.delete(requestId)
    else ids.add(requestId)
    return ids.size ? { status, ids, anchorId: requestId } : null
  }
  return { status, ids: new Set([requestId]), anchorId: requestId }
}
