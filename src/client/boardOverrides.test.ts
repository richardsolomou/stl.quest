import { describe, expect, it } from 'vitest'
import type { PublicPrintRequest } from '../core/types'
import { moveBoardOverride, reconcileBoardOverrides, reorderBoardOverride, type BoardOverride } from './boardOverrides'

const request = { id: 'request', counts: { todo: 1 }, orders: { todo: 2 } } as unknown as PublicPrintRequest
const override: BoardOverride = { counts: { todo: 1 }, orders: { todo: 2 } }

describe('reconcileBoardOverrides', () => {
  it('removes an override reflected by live data', () => {
    expect(reconcileBoardOverrides({ request: override }, [request])).toEqual({})
  })

  it('removes an override whose request disappeared', () => {
    expect(reconcileBoardOverrides({ request: override }, [])).toEqual({})
  })

  it('preserves the collection while live data is stale', () => {
    const overrides = { request: { ...override, counts: { todo: 2 } } }
    expect(reconcileBoardOverrides(overrides, [request])).toBe(overrides)
  })
})

describe('board override transitions', () => {
  const movingRequest = {
    id: 'moving',
    counts: { todo: 2, done: 0 },
    orders: { todo: 4, done: 10 },
  } as unknown as PublicPrintRequest

  it('moves copies and carries queue order into an empty destination', () => {
    expect(moveBoardOverride(movingRequest, undefined, 'todo', 'done', 1, 'done', 123)).toEqual({
      counts: { todo: 1, done: 1 },
      orders: { todo: 4, done: 4 },
      completedAt: 123,
    })
  })

  it('clears completion time when the last completed copy reopens', () => {
    const completed = {
      ...movingRequest,
      counts: { todo: 0, done: 1 },
      completedAt: 123,
    } as PublicPrintRequest

    expect(moveBoardOverride(completed, undefined, 'done', 'todo', 1, 'done', 456).completedAt).toBeUndefined()
  })

  it('preserves an existing destination order', () => {
    const current = { counts: { todo: 2, done: 1 }, orders: { todo: 4, done: 10 }, completedAt: 123 }

    expect(moveBoardOverride(movingRequest, current, 'todo', 'done', 1, 'done', 456).orders.done).toBe(10)
  })

  it('updates one queue order without changing counts', () => {
    expect(reorderBoardOverride(movingRequest, undefined, 'todo', 8)).toEqual({
      counts: movingRequest.counts,
      orders: { todo: 8, done: 10 },
      completedAt: undefined,
    })
  })
})
