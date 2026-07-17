import type { StatusId } from '../core/workflow'

export function canDropOnColumn(from: unknown, to: StatusId) {
  return typeof from === 'string' && from !== to
}

type RequestDropData = { requesterId?: unknown; requestId?: unknown }

export function canDropOnRequest(source: RequestDropData, target: { requesterId: string; requestId: string }) {
  return source.requesterId === target.requesterId && source.requestId !== target.requestId
}
