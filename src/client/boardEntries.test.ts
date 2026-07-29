import { describe, expect, it } from 'vitest'
import type { PrintGroup, PublicPrintRequest } from '../core/types'
import { boardEntriesByStatus, boardGroupsByStatus } from './boardEntries'

const first = {
  id: 'first',
  counts: { todo: 3, done: 0 },
  groups: [{ id: 'group', name: 'Batch', status: 'todo', count: 1 }],
} as unknown as PublicPrintRequest
const second = { id: 'second', counts: { todo: 1, done: 1 }, groups: [] } as unknown as PublicPrintRequest
const group = {
  id: 'group',
  name: 'Batch',
  status: 'todo',
  items: [{ requestId: 'first', count: 1 }],
} as PrintGroup
const statuses = [
  { id: 'todo', label: 'Queue', folder: 'todo', empty: 'Empty' },
  { id: 'done', label: 'Done', folder: 'done', empty: 'Empty' },
] as const

describe('boardEntriesByStatus', () => {
  it('separates ungrouped entries while preserving total copy counts', () => {
    const result = boardEntriesByStatus(
      [first, second],
      [group],
      statuses,
      (request) => request.counts,
      (left, right) => right.id.localeCompare(left.id),
    )

    expect(result.get('todo')).toEqual({
      entries: [
        { request: second, count: 1 },
        { request: first, count: 2 },
      ],
      total: 4,
    })
  })

  it('omits requests without ungrouped copies', () => {
    const result = boardEntriesByStatus(
      [{ ...first, counts: { todo: 1, done: 0 } }],
      [group],
      statuses,
      (request) => request.counts,
      () => 0,
    )

    expect(result.get('todo')?.entries).toEqual([])
  })
})

describe('boardGroupsByStatus', () => {
  it('resolves group items once and omits stale request references', () => {
    const staleGroup = { ...group, items: [...group.items, { requestId: 'missing', count: 2, order: 2 }] }

    expect(boardGroupsByStatus([first], [staleGroup]).get('todo')).toEqual([{ group: staleGroup, items: [{ request: first, count: 1 }] }])
  })
})
