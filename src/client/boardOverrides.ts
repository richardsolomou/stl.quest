import type { PublicPrintRequest } from '../core/types'
import type { StatusId } from '../core/workflow'

export type BoardOverride = {
  counts: PublicPrintRequest['counts']
  orders: PublicPrintRequest['orders']
  groups: PublicPrintRequest['groups']
  completedAt?: number
}

export type BoardMove = {
  request: PublicPrintRequest
  from: StatusId
  to: StatusId
  count: number
  groupId?: string
}

export function moveBoardOverrides(
  overrides: Record<string, BoardOverride>,
  moves: BoardMove[],
  completedStatus: StatusId | undefined,
  now = Date.now(),
) {
  const next = { ...overrides }
  for (const { request, from, to, count, groupId } of moves) {
    next[request.id] = groupId
      ? moveGroupedBoardOverride(request, next[request.id], from, to, count, groupId, completedStatus, now)
      : moveBoardOverride(request, next[request.id], from, to, count, completedStatus, now)
  }
  return next
}

export function moveBoardOverride(
  request: PublicPrintRequest,
  override: BoardOverride | undefined,
  from: StatusId,
  to: StatusId,
  count: number,
  completedStatus: StatusId | undefined,
  now = Date.now(),
): BoardOverride {
  const current = boardRequestState(request, override)
  const counts = { ...current.counts, [from]: current.counts[from] - count, [to]: current.counts[to] + count }
  const groups = current.groups.flatMap((group) => {
    if (group.status !== from) return [group]
    const moved = Math.min(group.count, count)
    const remaining = group.count - moved
    const destination = current.groups.find((candidate) => candidate.id === group.id && candidate.status === to)
    return [...(remaining > 0 ? [{ ...group, count: remaining }] : []), ...(destination ? [] : [{ ...group, status: to, count: moved }])]
  })
  for (const group of groups) {
    if (group.status !== to) continue
    const source = current.groups.find((candidate) => candidate.id === group.id && candidate.status === from)
    const destination = current.groups.find((candidate) => candidate.id === group.id && candidate.status === to)
    if (source && destination) group.count = destination.count + Math.min(source.count, count)
  }
  return {
    counts,
    orders: current.counts[to] > 0 ? current.orders : { ...current.orders, [to]: current.orders[from] },
    groups,
    completedAt: to === completedStatus ? now : from === completedStatus && counts[from] === 0 ? undefined : current.completedAt,
  }
}

export function moveUngroupedBoardOverride(
  request: PublicPrintRequest,
  override: BoardOverride | undefined,
  from: StatusId,
  to: StatusId,
  count: number,
  completedStatus: StatusId | undefined,
  now = Date.now(),
): BoardOverride {
  const current = boardRequestState(request, override)
  const counts = { ...current.counts, [from]: current.counts[from] - count, [to]: current.counts[to] + count }
  return {
    counts,
    orders: current.counts[to] > 0 ? current.orders : { ...current.orders, [to]: current.orders[from] },
    groups: current.groups,
    completedAt: to === completedStatus ? now : from === completedStatus && counts[from] === 0 ? undefined : current.completedAt,
  }
}

export function moveGroupedBoardOverride(
  request: PublicPrintRequest,
  override: BoardOverride | undefined,
  from: StatusId,
  to: StatusId,
  count: number,
  groupId: string,
  completedStatus: StatusId | undefined,
  now = Date.now(),
): BoardOverride {
  const current = boardRequestState(request, override)
  const counts = { ...current.counts, [from]: current.counts[from] - count, [to]: current.counts[to] + count }
  const source = current.groups.find((group) => group.id === groupId && group.status === from)
  const destination = current.groups.find((group) => group.id === groupId && group.status === to)
  const groups = current.groups.flatMap((group) => {
    if (group !== source && group !== destination) return [group]
    if (group === destination) return [{ ...group, count: group.count + count }]
    const remaining = group.count - count
    return [...(remaining > 0 ? [{ ...group, count: remaining }] : []), ...(destination ? [] : [{ ...group, status: to, count }])]
  })
  return {
    counts,
    orders: current.counts[to] > 0 ? current.orders : { ...current.orders, [to]: current.orders[from] },
    groups,
    completedAt: to === completedStatus ? now : from === completedStatus && counts[from] === 0 ? undefined : current.completedAt,
  }
}

export function reorderBoardOverride(
  request: PublicPrintRequest,
  override: BoardOverride | undefined,
  status: StatusId,
  order: number,
): BoardOverride {
  const current = boardRequestState(request, override)
  return { ...current, orders: { ...current.orders, [status]: order } }
}

export function deleteBoardOverride(
  request: PublicPrintRequest,
  override: BoardOverride | undefined,
  status: StatusId,
  count: number,
): BoardOverride {
  const current = boardRequestState(request, override)
  return { ...current, counts: { ...current.counts, [status]: current.counts[status] - count } }
}

export function reconcileBoardOverrides(overrides: Record<string, BoardOverride>, requests: PublicPrintRequest[]) {
  const requestsById = new Map(requests.map((request) => [request.id, request]))
  let next = overrides
  for (const [id, override] of Object.entries(overrides)) {
    const request = requestsById.get(id)
    const settled =
      !request ||
      (JSON.stringify(request.counts) === JSON.stringify(override.counts) &&
        JSON.stringify(request.orders) === JSON.stringify(override.orders) &&
        JSON.stringify(request.groups) === JSON.stringify(override.groups))
    if (settled) {
      if (next === overrides) next = { ...overrides }
      delete next[id]
    }
  }
  return next
}

export function boardRequestState(request: PublicPrintRequest, override?: BoardOverride): BoardOverride {
  return override ?? { counts: request.counts, orders: request.orders, groups: request.groups, completedAt: request.completedAt }
}
