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

export function shouldSplitStackOnDrop(input: { altKey: boolean }) {
  return input.altKey
}

export function boardDropEffect(input: { altKey: boolean }) {
  return input.altKey ? 'copy' : 'move'
}

export function boardCardKey(requestId: string, status: StatusId) {
  return `${requestId}:${status}`
}

/**
 * Chromium (unlike WebKit) starts a native HTML5 drag from a touch long-press on a
 * `draggable` element, which wins the race against the long-press context menu. This
 * flag is how the browser tells us a `dragstart` came from touch rather than a mouse.
 */
export function isTouchOriginatedDragStart(event: unknown) {
  const capabilities = (event as { sourceCapabilities?: { firesTouchEvents?: boolean } | null })?.sourceCapabilities
  return capabilities?.firesTouchEvents ?? false
}
