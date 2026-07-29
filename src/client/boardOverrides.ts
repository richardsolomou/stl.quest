import type { PublicPrintRequest } from '../core/types'
import type { StatusId } from '../core/workflow'

export type BoardOverride = {
  counts: PublicPrintRequest['counts']
  orders: PublicPrintRequest['orders']
  completedAt?: number
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
  const current = boardOverride(request, override)
  const counts = { ...current.counts, [from]: current.counts[from] - count, [to]: current.counts[to] + count }
  return {
    counts,
    orders: current.counts[to] > 0 ? current.orders : { ...current.orders, [to]: current.orders[from] },
    completedAt: to === completedStatus ? now : from === completedStatus && counts[from] === 0 ? undefined : current.completedAt,
  }
}

export function reorderBoardOverride(
  request: PublicPrintRequest,
  override: BoardOverride | undefined,
  status: StatusId,
  order: number,
): BoardOverride {
  const current = boardOverride(request, override)
  return { ...current, orders: { ...current.orders, [status]: order } }
}

export function reconcileBoardOverrides(overrides: Record<string, BoardOverride>, requests: PublicPrintRequest[]) {
  const requestsById = new Map(requests.map((request) => [request.id, request]))
  let next = overrides
  for (const [id, override] of Object.entries(overrides)) {
    const request = requestsById.get(id)
    const settled =
      !request ||
      (JSON.stringify(request.counts) === JSON.stringify(override.counts) &&
        JSON.stringify(request.orders) === JSON.stringify(override.orders))
    if (settled) {
      if (next === overrides) next = { ...overrides }
      delete next[id]
    }
  }
  return next
}

function boardOverride(request: PublicPrintRequest, override?: BoardOverride): BoardOverride {
  return override ?? { counts: request.counts, orders: request.orders, completedAt: request.completedAt }
}
