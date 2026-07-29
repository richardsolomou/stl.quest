import { describe, expect, it } from 'vitest'
import { MAX_PRINT_GROUP_NAME_LENGTH, validPrintGroupName } from './printGroups'

describe('print group names', () => {
  it('accepts a name at the maximum length', () => {
    expect(validPrintGroupName('x'.repeat(MAX_PRINT_GROUP_NAME_LENGTH))).toBe(true)
  })

  it.each(['', '   ', 'x'.repeat(MAX_PRINT_GROUP_NAME_LENGTH + 1)])('rejects invalid name %j', (name) => {
    expect(validPrintGroupName(name)).toBe(false)
  })
})
