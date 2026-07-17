import type { StatusId } from '../core/workflow'

export function canDropOnColumn(from: unknown, to: StatusId) {
  return typeof from === 'string' && from !== to
}

export function canDropOnRequest(sourceRequesterId: unknown, targetRequesterId: string) {
  return sourceRequesterId === targetRequesterId
}
