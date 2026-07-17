import { requestQueueOrder } from './types'

export type RequestQueueItem = {
  id: string
  requesterId?: string
  orders: Record<string, number | undefined>
  createdAt: number
}

export type RequestQueuePriority = {
  position: number
  queuedAt: number
  slotId: string
}

export function requesterQueuePriorities(requests: RequestQueueItem[], status: string) {
  const byRequester = new Map<string, RequestQueueItem[]>()
  for (const request of requests) {
    const requesterId = request.requesterId ?? request.id
    const owned = byRequester.get(requesterId) ?? []
    owned.push(request)
    byRequester.set(requesterId, owned)
  }

  const priorities = new Map<string, RequestQueuePriority>()
  for (const owned of byRequester.values()) {
    const ordered = [...owned].sort(
      (first, second) => requestQueueOrder(first, status) - requestQueueOrder(second, status) || first.id.localeCompare(second.id),
    )
    const slots = [...owned].sort((first, second) => second.createdAt - first.createdAt || first.id.localeCompare(second.id))
    ordered.forEach((request, position) => {
      const slot = slots[position]
      priorities.set(request.id, { position, queuedAt: slot.createdAt, slotId: slot.id })
    })
  }
  return priorities
}

export function compareRequestQueueSlots(first: RequestQueueItem, second: RequestQueueItem, priorities: Map<string, RequestQueuePriority>) {
  const firstPriority = priorities.get(first.id)
  const secondPriority = priorities.get(second.id)
  if (!firstPriority || !secondPriority) return first.id.localeCompare(second.id)
  return secondPriority.queuedAt - firstPriority.queuedAt || firstPriority.slotId.localeCompare(secondPriority.slotId)
}
