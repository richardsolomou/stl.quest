import { describe, expect, it } from 'vitest'
import { canDropOnColumn } from './boardDrag'

describe('board drag helpers', () => {
  it('rejects blank space in the source column', () => {
    expect(canDropOnColumn('queued', 'queued')).toBe(false)
  })

  it('accepts blank space in another column', () => {
    expect(canDropOnColumn('queued', 'printing')).toBe(true)
  })
})
