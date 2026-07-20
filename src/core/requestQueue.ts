import { requestQueueOrder } from './types'

export type RequestQueueItem = {
  id: string
  requesterId?: string
  requesterName?: string
  mine?: boolean
  orders: Record<string, number | undefined>
  createdAt: number
  completedAt?: number
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

export function compareRequesterPriorityQueues(
  first: RequestQueueItem,
  second: RequestQueueItem,
  priorities: Map<string, RequestQueuePriority>,
) {
  const firstPriority = priorities.get(first.id)
  const secondPriority = priorities.get(second.id)
  if (!firstPriority || !secondPriority) return first.id.localeCompare(second.id)
  if (first.requesterId !== second.requesterId) {
    if (first.mine !== second.mine) return first.mine ? -1 : 1
    return (first.requesterName ?? first.requesterId ?? first.id).localeCompare(second.requesterName ?? second.requesterId ?? second.id)
  }
  return firstPriority.position - secondPriority.position || first.id.localeCompare(second.id)
}

export function compareRoundRobinQueue(first: RequestQueueItem, second: RequestQueueItem, priorities: Map<string, RequestQueuePriority>) {
  const firstPriority = priorities.get(first.id)
  const secondPriority = priorities.get(second.id)
  if (!firstPriority || !secondPriority) return first.id.localeCompare(second.id)
  if (firstPriority.position !== secondPriority.position) return firstPriority.position - secondPriority.position
  return (
    (first.requesterName ?? first.requesterId ?? first.id).localeCompare(second.requesterName ?? second.requesterId ?? second.id) ||
    firstPriority.slotId.localeCompare(secondPriority.slotId)
  )
}

export function compareCompletedQueue(first: RequestQueueItem, second: RequestQueueItem, priorities: Map<string, RequestQueuePriority>) {
  return (second.completedAt ?? 0) - (first.completedAt ?? 0) || compareRequesterPriorityQueues(first, second, priorities)
}
