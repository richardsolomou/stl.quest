import { describe, expect, it } from 'vitest'
import { compareRequestQueueSlots, requesterQueuePriorities, type RequestQueueItem } from './requestQueue'

const request = (id: string, requesterId: string, createdAt: number, order?: number): RequestQueueItem => ({
  id,
  requesterId,
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

  it('swaps only the reordered requester cards in the shared board', () => {
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

    expect([...reordered].sort((first, second) => compareRequestQueueSlots(first, second, priorities)).map(({ id }) => id)).toEqual([
      'mine-old',
      'theirs-new',
      'mine-new',
      'theirs-old',
    ])
  })
})
