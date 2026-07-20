import { describe, expect, it } from 'vitest'
import {
  compareCompletedQueue,
  compareRequesterPriorityQueues,
  compareRoundRobinQueue,
  requesterQueuePriorities,
  type RequestQueueItem,
} from './requestQueue'

const request = (id: string, requesterId: string, createdAt: number, order?: number): RequestQueueItem => ({
  id,
  requesterId,
  requesterName: requesterId === 'admin' ? 'Owner' : 'Requester',
  mine: requesterId === 'admin',
  createdAt,
  orders: { todo: order },
})

describe('request queues', () => {
  it('keeps another requester queue slot unchanged', () => {
    const requests = [request('mine-new', 'admin', 40), request('theirs-new', 'user', 30), request('mine-old', 'admin', 20)]
    const before = requesterQueuePriorities(requests, 'todo')
    const reordered = requests.map((item) =>
      item.id === 'mine-old' ? { ...item, orders: { todo: -100 } } : item.id === 'mine-new' ? { ...item, orders: { todo: 100 } } : item,
    )
    const after = requesterQueuePriorities(reordered, 'todo')

    expect(after.get('theirs-new')).toEqual(before.get('theirs-new'))
  })

  it('groups requester queues while preserving their chosen priority', () => {
    const requests = [
      request('mine-new', 'admin', 40),
      request('theirs-new', 'user', 30),
      request('mine-old', 'admin', 20),
      request('theirs-old', 'user', 10),
    ]
    const reordered = requests.map((item) =>
      item.id === 'mine-old' ? { ...item, orders: { todo: -100 } } : item.id === 'mine-new' ? { ...item, orders: { todo: 100 } } : item,
    )
    const priorities = requesterQueuePriorities(reordered, 'todo')

    expect([...reordered].sort((first, second) => compareRequesterPriorityQueues(first, second, priorities)).map(({ id }) => id)).toEqual([
      'mine-old',
      'mine-new',
      'theirs-new',
      'theirs-old',
    ])
  })

  it('interleaves each requester priority level in round robin order', () => {
    const requests = [
      request('mine-new', 'admin', 40),
      request('theirs-new', 'user', 30),
      request('mine-old', 'admin', 20),
      request('theirs-old', 'user', 10),
    ]
    const reordered = requests.map((item) =>
      item.id === 'mine-old' ? { ...item, orders: { todo: -100 } } : item.id === 'mine-new' ? { ...item, orders: { todo: 100 } } : item,
    )
    const priorities = requesterQueuePriorities(reordered, 'todo')

    expect([...reordered].sort((first, second) => compareRoundRobinQueue(first, second, priorities)).map(({ id }) => id)).toEqual([
      'mine-old',
      'theirs-new',
      'mine-new',
      'theirs-old',
    ])
  })

  it('orders completed requests newest first and uses priority for ties', () => {
    const requests = [
      { ...request('older', 'admin', 30, 0), completedAt: 100 },
      { ...request('newer', 'admin', 20, 2), completedAt: 200 },
      { ...request('tied-priority', 'admin', 10, 1), completedAt: 200 },
    ].map((item) => ({ ...item, orders: { done: item.orders.todo } }))
    const priorities = requesterQueuePriorities(requests, 'done')

    expect([...requests].sort((first, second) => compareCompletedQueue(first, second, priorities)).map(({ id }) => id)).toEqual([
      'tied-priority',
      'newer',
      'older',
    ])
  })
})
