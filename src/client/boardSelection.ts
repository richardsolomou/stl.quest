import type { StatusId } from '../core/workflow'

export type BoardSelection = { status: StatusId; ids: Set<string>; anchorId: string }

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
