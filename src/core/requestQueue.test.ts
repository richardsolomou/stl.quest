import { describe, expect, it } from 'vitest'
import { compareRequesterPriorityQueues, compareRoundRobinQueue, requesterQueuePriorities, type RequestQueueItem } from './requestQueue'

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
})
