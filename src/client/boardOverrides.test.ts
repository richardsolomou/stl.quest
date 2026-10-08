import { describe, expect, it } from 'vitest'
import type { PublicPrintRequest } from '../core/types'
import {
  deleteBoardOverride,
  moveBoardOverride,
  moveBoardOverrides,
  reconcileBoardOverrides,
  reorderBoardOverride,
  type BoardOverride,
} from './boardOverrides'

const request = { id: 'request', counts: { todo: 1 }, orders: { todo: 2 }, groups: [] } as unknown as PublicPrintRequest
const override: BoardOverride = { counts: { todo: 1 }, orders: { todo: 2 }, groups: [], pendingCounts: true }

describe('reconcileBoardOverrides', () => {
  it('removes an override reflected by live data', () => {
    expect(reconcileBoardOverrides({ request: override }, [request])).toEqual({})
  })

  it('removes an override whose request disappeared', () => {
    expect(reconcileBoardOverrides({ request: override }, [])).toEqual({})
  })

  it('removes a settled override when unrelated tag data changed', () => {
    const taggedRequest = {
      ...request,
      groups: [{ id: 'tag', name: 'Plate 14', color: 'blue', status: 'todo', count: 1 }],
    } as PublicPrintRequest

    expect(reconcileBoardOverrides({ request: override }, [taggedRequest])).toEqual({})
  })

  it('preserves the collection while live data is stale', () => {
    const overrides = { request: { ...override, counts: { todo: 2 } } }
    expect(reconcileBoardOverrides(overrides, [request])).toBe(overrides)
  })

  it('preserves a reorder override until its order is live', () => {
    const overrides = { request: reorderBoardOverride(request, undefined, 'todo', 8) }
    expect(reconcileBoardOverrides(overrides, [request])).toBe(overrides)
  })
})

describe('board override transitions', () => {
  const movingRequest = {
    id: 'moving',
    counts: { todo: 2, done: 0 },
    orders: { todo: 4, done: 10 },
    groups: [{ id: 'tag', name: 'Plate 14', color: 'blue', status: 'todo', count: 1 }],
  } as unknown as PublicPrintRequest

  it('moves copies and carries queue order into an empty destination', () => {
    expect(moveBoardOverride(movingRequest, undefined, 'todo', 'done', 1, ['tag'], 'done', 123)).toEqual({
      counts: { todo: 1, done: 1 },
      orders: { todo: 4, done: 4 },
      groups: [{ id: 'tag', name: 'Plate 14', color: 'blue', status: 'done', count: 1 }],
      completedAt: 123,
      pendingCounts: true,
    })
  })

  it('moves a mixed batch in one optimistic state', () => {
    const groupedRequest = { ...movingRequest, id: 'grouped' }

    expect(
      moveBoardOverrides(
        {},
        [
          { request: movingRequest, from: 'todo', to: 'done', count: 1, tagIds: [] },
          { request: groupedRequest, from: 'todo', to: 'done', count: 1, tagIds: ['tag'] },
        ],
        'done',
        123,
      ),
    ).toMatchObject({
      moving: { counts: { todo: 1, done: 1 }, completedAt: 123 },
      grouped: {
        counts: { todo: 1, done: 1 },
        groups: [{ id: 'tag', name: 'Plate 14', color: 'blue', status: 'done', count: 1 }],
        completedAt: 123,
      },
    })
  })

  it('keeps tag assignments in place when a batch moves untagged copies', () => {
    expect(moveBoardOverrides({}, [{ request: movingRequest, from: 'todo', to: 'done', count: 1, tagIds: [] }], 'done', 123)).toMatchObject(
      {
        moving: { groups: movingRequest.groups },
      },
    )
  })

  it('moves untagged copies without moving tag assignments', () => {
    expect(moveBoardOverride(movingRequest, undefined, 'todo', 'done', 1, [], 'done', 123)).toEqual({
      counts: { todo: 1, done: 1 },
      orders: { todo: 4, done: 4 },
      groups: movingRequest.groups,
      completedAt: 123,
      pendingCounts: true,
    })
  })

  it('moves one tagged cohort without moving untagged copies', () => {
    expect(moveBoardOverride(movingRequest, undefined, 'todo', 'done', 1, ['tag'], 'done', 123)).toEqual({
      counts: { todo: 1, done: 1 },
      orders: { todo: 4, done: 4 },
      groups: [{ id: 'tag', name: 'Plate 14', color: 'blue', status: 'done', count: 1 }],
      completedAt: 123,
      pendingCounts: true,
    })
  })

  it('adds a tagged cohort to an existing destination assignment', () => {
    const current = {
      counts: { todo: 1, done: 1 },
      orders: movingRequest.orders,
      groups: [
        { ...movingRequest.groups[0], status: 'todo', count: 1 },
        { ...movingRequest.groups[0], status: 'done', count: 1 },
      ],
    }

    expect(moveBoardOverride(movingRequest, current, 'todo', 'done', 1, ['tag'], 'done').groups).toEqual([
      { ...movingRequest.groups[0], status: 'done', count: 2 },
    ])
  })

  it('moves a multi-tag card with only the tags its copies carry', () => {
    const multiTag = {
      ...movingRequest,
      groups: ['a', 'b', 'c'].map((id) => ({ id, name: id, color: 'blue', status: 'todo', count: id === 'a' ? 2 : 1 })),
    } as unknown as PublicPrintRequest

    expect(
      moveBoardOverride(multiTag, undefined, 'todo', 'done', 1, ['a', 'b'], 'done', 123).groups.map(({ id, status, count }) => [
        id,
        status,
        count,
      ]),
    ).toEqual([
      ['a', 'todo', 1],
      ['a', 'done', 1],
      ['b', 'done', 1],
      ['c', 'todo', 1],
    ])
  })

  it('clears completion time when the last completed copy reopens', () => {
    const completed = {
      ...movingRequest,
      counts: { todo: 0, done: 1 },
      completedAt: 123,
    } as PublicPrintRequest

    expect(moveBoardOverride(completed, undefined, 'done', 'todo', 1, [], 'done', 456).completedAt).toBeUndefined()
  })

  it('preserves an existing destination order', () => {
    const current = { counts: { todo: 2, done: 1 }, orders: { todo: 4, done: 10 }, groups: movingRequest.groups, completedAt: 123 }

    expect(moveBoardOverride(movingRequest, current, 'todo', 'done', 1, [], 'done', 456).orders.done).toBe(10)
  })

  it('updates one queue order without changing counts', () => {
    expect(reorderBoardOverride(movingRequest, undefined, 'todo', 8)).toEqual({
      counts: movingRequest.counts,
      orders: { todo: 8, done: 10 },
      groups: movingRequest.groups,
      completedAt: undefined,
      pendingOrders: true,
    })
  })

  it('deletes from an optimistic move when live data skips the intermediate state', () => {
    const moved = moveBoardOverride(movingRequest, undefined, 'todo', 'done', 1, [], 'done', 123)

    expect(deleteBoardOverride(movingRequest, moved, 'done', 1).counts).toEqual({ todo: 1, done: 0 })
  })
})
