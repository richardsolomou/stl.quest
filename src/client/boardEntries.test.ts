import { describe, expect, it } from 'vitest'
import type { PrintGroup, PublicPrintRequest } from '../core/types'
import { boardEntriesByStatus, boardGroupsByStatus, boardPrioritiesByStatus, boardTagCopyCounts } from './boardEntries'

const first = {
  id: 'first',
  counts: { todo: 3, done: 0 },
  groups: [{ id: 'group', name: 'Batch', color: 'blue', status: 'todo', count: 1 }],
} as unknown as PublicPrintRequest
const second = { id: 'second', counts: { todo: 1, done: 1 }, groups: [] } as unknown as PublicPrintRequest
const group = {
  id: 'group',
  name: 'Batch',
  status: 'todo',
  items: [{ requestId: 'first', status: 'todo', count: 1, order: 0 }],
} as PrintGroup
const statuses = [
  { id: 'todo', label: 'Queue', folder: 'todo', empty: 'Empty' },
  { id: 'up_next', label: 'Up next', folder: 'up-next', empty: 'Empty' },
  { id: 'done', label: 'Done', folder: 'done', empty: 'Empty' },
] as const

describe('boardEntriesByStatus', () => {
  it('keeps provenance-tagged and ungrouped prints together in flat queues', () => {
    const result = boardEntriesByStatus(
      [first, second],
      [group],
      statuses,
      (request) => request.counts,
      (request) => request.groups,
      (left, right) => right.id.localeCompare(left.id),
    )

    expect(result.get('todo')).toEqual({
      entries: [
        { request: second, count: 1 },
        { request: first, count: 3 },
      ],
      total: 4,
    })
  })

  it('keeps tagged copies in the flat queue', () => {
    const result = boardEntriesByStatus(
      [
        {
          ...first,
          counts: { todo: 0, up_next: 1, done: 0 },
          groups: [{ id: 'group', name: 'Batch', color: 'blue', status: 'up_next', count: 1 }],
        },
      ],
      [{ ...group, status: 'up_next', items: [{ ...group.items[0], status: 'up_next' }] }],
      statuses,
      (request) => request.counts,
      (request) => request.groups,
      () => 0,
    )

    expect(result.get('up_next')?.entries).toEqual([
      {
        request: expect.objectContaining({ id: 'first' }),
        count: 1,
      },
    ])
  })
})

describe('boardGroupsByStatus', () => {
  it('resolves group items once and omits stale request references', () => {
    const staleGroup = { ...group, items: [...group.items, { requestId: 'missing', status: 'todo', count: 2, order: 2 }] }

    expect(boardGroupsByStatus([first], [staleGroup]).get('todo')).toEqual([{ group: staleGroup, items: [{ request: first, count: 1 }] }])
  })

  it('projects one plate into every stage containing its prints', () => {
    const split = {
      ...group,
      items: [group.items[0], { requestId: 'second', status: 'done', count: 1, order: 1 }],
    }

    const result = boardGroupsByStatus([first, second], [split])

    expect([...result.keys()]).toEqual(['todo', 'done'])
    expect(result.get('todo')?.[0].items).toEqual([{ request: first, count: 1 }])
    expect(result.get('done')?.[0].items).toEqual([{ request: second, count: 1 }])
  })
})

describe('boardTagCopyCounts', () => {
  it('totals every tagged copy in each stage', () => {
    const split = {
      ...group,
      items: [
        group.items[0],
        { requestId: 'second', status: 'todo', count: 2, order: 1 },
        { requestId: 'second', status: 'done', count: 1, order: 2 },
      ],
    }

    expect(boardTagCopyCounts([split])).toEqual(
      new Map([
        ['todo:group', 3],
        ['done:group', 1],
      ]),
    )
  })
})

describe('boardPrioritiesByStatus', () => {
  it('uses optimistic counts and orders when deriving requester priorities', () => {
    const queued = [
      { ...first, requesterId: 'requester', orders: { todo: 1 }, createdAt: 1 },
      { ...second, requesterId: 'requester', orders: { todo: 2 }, createdAt: 2 },
    ]
    const priorities = boardPrioritiesByStatus(queued, statuses, {
      first: { counts: { todo: 0, done: 0 }, orders: { todo: 1 }, groups: first.groups },
      second: { counts: second.counts, orders: { todo: 0 }, groups: second.groups },
    })

    expect(priorities.get('todo')?.has('first')).toBe(false)
    expect(priorities.get('todo')?.get('second')?.position).toBe(0)
  })
})
