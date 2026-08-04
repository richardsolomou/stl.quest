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
  it('separates tagged and untagged copies in flat queues', () => {
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
        { request: second, count: 1, key: 'second:todo:untagged' },
        { request: first, count: 1, key: 'first:todo:group', groupId: 'group' },
        { request: { ...first, groups: [] }, count: 2, key: 'first:todo:untagged' },
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
        key: 'first:up_next:group',
        groupId: 'group',
      },
    ])
  })

  it('keeps copies with different tags as separate entries', () => {
    const tagged = {
      ...first,
      counts: { todo: 2, done: 0 },
      groups: [
        { id: 'plate-1', name: 'Plate 1', color: 'blue', status: 'todo', count: 1 },
        { id: 'plate-2', name: 'Plate 2', color: 'green', status: 'todo', count: 1 },
      ],
    } as PublicPrintRequest

    const result = boardEntriesByStatus(
      [tagged],
      [],
      statuses,
      (request) => request.counts,
      (request) => request.groups,
      () => 0,
    )

    expect(result.get('todo')?.entries).toEqual([
      { request: { ...tagged, groups: [tagged.groups[0]] }, count: 1, key: 'first:todo:plate-1', groupId: 'plate-1' },
      { request: { ...tagged, groups: [tagged.groups[1]] }, count: 1, key: 'first:todo:plate-2', groupId: 'plate-2' },
    ])
  })

  it('keeps overlapping tags on the same copies', () => {
    const tagged = {
      ...first,
      counts: { todo: 1, done: 0 },
      groups: [
        { id: 'plate', name: 'Plate', color: 'blue', status: 'todo', count: 1 },
        { id: 'urgent', name: 'Urgent', color: 'green', status: 'todo', count: 1 },
      ],
    } as PublicPrintRequest

    const result = boardEntriesByStatus(
      [tagged],
      [],
      statuses,
      (request) => request.counts,
      (request) => request.groups,
      () => 0,
    )

    expect(result.get('todo')?.entries).toEqual([{ request: tagged, count: 1, key: 'first:todo:plate,urgent' }])
  })

  it('shows only matching cohort copies when filtering by a tag', () => {
    const tagged = {
      ...first,
      counts: { todo: 3, done: 0 },
      groups: [
        { id: 'plate-1', name: 'Plate 1', color: 'blue', status: 'todo', count: 1 },
        { id: 'plate-2', name: 'Plate 2', color: 'green', status: 'todo', count: 1 },
      ],
    } as PublicPrintRequest

    const result = boardEntriesByStatus(
      [tagged],
      [],
      statuses,
      (request) => request.counts,
      (request) => request.groups,
      () => 0,
      new Set(['plate-1']),
    )

    expect(result.get('todo')).toEqual({
      entries: [{ request: { ...tagged, groups: [tagged.groups[0]] }, count: 1, key: 'first:todo:plate-1', groupId: 'plate-1' }],
      total: 1,
    })
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
