import { describe, expect, it } from 'vitest'
import { canDropOnColumn, canDropOnRequest } from './boardDrag'

describe('board drag helpers', () => {
  it('rejects blank space in the source column', () => {
    expect(canDropOnColumn('queued', 'queued')).toBe(false)
  })

  it('accepts blank space in another column', () => {
    expect(canDropOnColumn('queued', 'printing')).toBe(true)
  })

  it('rejects another requester card', () => {
    expect(
      canDropOnRequest(
        { from: 'todo', requesterId: 'admin', requestId: 'admin-request' },
        { status: 'todo', requesterId: 'requester', requestId: 'requester-request' },
        true,
      ),
    ).toBe(false)
  })

  it('rejects the dragged card itself', () => {
    expect(
      canDropOnRequest(
        { from: 'todo', requesterId: 'requester', requestId: 'request' },
        { status: 'todo', requesterId: 'requester', requestId: 'request' },
        true,
      ),
    ).toBe(false)
  })

  it('accepts another card from the same requester', () => {
    expect(
      canDropOnRequest(
        { from: 'todo', requesterId: 'requester', requestId: 'first' },
        { status: 'todo', requesterId: 'requester', requestId: 'second' },
        true,
      ),
    ).toBe(true)
  })

  it('rejects same-column reordering while a calculated sort is active', () => {
    expect(
      canDropOnRequest(
        { from: 'todo', requesterId: 'requester', requestId: 'first' },
        { status: 'todo', requesterId: 'requester', requestId: 'second' },
        false,
      ),
    ).toBe(false)
  })

  it('allows cross-column moves while a calculated sort is active', () => {
    expect(
      canDropOnRequest(
        { from: 'todo', requesterId: 'requester', requestId: 'first' },
        { status: 'in_progress', requesterId: 'other', requestId: 'second' },
        false,
      ),
    ).toBe(true)
  })
})
