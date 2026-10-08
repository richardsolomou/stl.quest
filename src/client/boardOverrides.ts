import type { PublicPrintRequest } from '../core/types'
import type { StatusId } from '../core/workflow'

export type BoardOverride = {
  counts: PublicPrintRequest['counts']
  orders: PublicPrintRequest['orders']
  groups: PublicPrintRequest['groups']
  completedAt?: number
  pendingCounts?: true
  pendingOrders?: true
}

/** Moves `count` copies of the card carrying exactly `tagIds`, with those tags. */
export type BoardMove = {
  request: PublicPrintRequest
  from: StatusId
  to: StatusId
  count: number
  tagIds: string[]
}

export function moveBoardOverrides(
  overrides: Record<string, BoardOverride>,
  moves: BoardMove[],
  completedStatus: StatusId | undefined,
  now = Date.now(),
) {
  const next = { ...overrides }
  for (const { request, from, to, count, tagIds } of moves) {
    next[request.id] = moveBoardOverride(request, next[request.id], from, to, count, tagIds, completedStatus, now)
  }
  return next
}

/** Moves `count` copies of the card carrying exactly `tagIds` and only those tags, as the server does. */
export function moveBoardOverride(
  request: PublicPrintRequest,
  override: BoardOverride | undefined,
  from: StatusId,
  to: StatusId,
  count: number,
  tagIds: string[],
  completedStatus: StatusId | undefined,
  now = Date.now(),
): BoardOverride {
  const current = boardRequestState(request, override)
  const counts = { ...current.counts, [from]: current.counts[from] - count, [to]: current.counts[to] + count }
  const moved = (group: BoardOverride['groups'][number]) => tagIds.includes(group.id)
  const groups = current.groups.flatMap((group) => {
    if (!moved(group) || (group.status !== from && group.status !== to)) return [group]
    if (group.status === to) return [{ ...group, count: group.count + count }]
    const destination = current.groups.some((candidate) => candidate.id === group.id && candidate.status === to)
    return [
      ...(group.count > count ? [{ ...group, count: group.count - count }] : []),
      ...(destination ? [] : [{ ...group, status: to, count }]),
    ]
  })
  return {
    ...current,
    counts,
    orders: current.counts[to] > 0 ? current.orders : { ...current.orders, [to]: current.orders[from] },
    groups,
    completedAt: to === completedStatus ? now : from === completedStatus && counts[from] === 0 ? undefined : current.completedAt,
    pendingCounts: true,
  }
}

export function reorderBoardOverride(
  request: PublicPrintRequest,
  override: BoardOverride | undefined,
  status: StatusId,
  order: number,
): BoardOverride {
  const current = boardRequestState(request, override)
  return { ...current, orders: { ...current.orders, [status]: order }, pendingOrders: true }
}

export function deleteBoardOverride(
  request: PublicPrintRequest,
  override: BoardOverride | undefined,
  status: StatusId,
  count: number,
): BoardOverride {
  const current = boardRequestState(request, override)
  return { ...current, counts: { ...current.counts, [status]: current.counts[status] - count }, pendingCounts: true }
}

export function reconcileBoardOverrides(overrides: Record<string, BoardOverride>, requests: PublicPrintRequest[]) {
  const requestsById = new Map(requests.map((request) => [request.id, request]))
  let next = overrides
  for (const [id, override] of Object.entries(overrides)) {
    const request = requestsById.get(id)
    const settled =
      !request ||
      ((!override.pendingCounts || JSON.stringify(request.counts) === JSON.stringify(override.counts)) &&
        (!override.pendingOrders || JSON.stringify(request.orders) === JSON.stringify(override.orders)))
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
