import type { StatusId } from '../core/workflow'

export function canDropOnColumn(from: unknown, to: StatusId) {
  return typeof from === 'string' && from !== to
}

type RequestDropData = { from?: unknown; requesterId?: unknown; requestId?: unknown }

export function canDropOnRequest(
  source: RequestDropData,
  target: { requesterId: string; requestId: string; status: StatusId },
  reorderEnabled: boolean,
) {
  if (source.from !== target.status) return true
  if (source.requestId === target.requestId) return false
  return reorderEnabled && source.requesterId === target.requesterId
}

export function canShowRequestDropEdge(from: unknown, to: StatusId, reorderEnabled: boolean) {
  return from === to && reorderEnabled
}
