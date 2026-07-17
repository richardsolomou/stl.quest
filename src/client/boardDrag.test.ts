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
      canDropOnRequest({ requesterId: 'admin', requestId: 'admin-request' }, { requesterId: 'requester', requestId: 'requester-request' }),
    ).toBe(false)
  })

  it('rejects the dragged card itself', () => {
    expect(canDropOnRequest({ requesterId: 'requester', requestId: 'request' }, { requesterId: 'requester', requestId: 'request' })).toBe(
      false,
    )
  })

  it('accepts another card from the same requester', () => {
    expect(canDropOnRequest({ requesterId: 'requester', requestId: 'first' }, { requesterId: 'requester', requestId: 'second' })).toBe(true)
  })
})
