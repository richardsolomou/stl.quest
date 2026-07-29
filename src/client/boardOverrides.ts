import type { PublicPrintRequest } from '../core/types'

export type BoardOverride = {
  counts: PublicPrintRequest['counts']
  orders: PublicPrintRequest['orders']
  completedAt?: number
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
