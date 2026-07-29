import { describe, expect, it } from 'vitest'
import { environmentFlag } from './environment'

describe('environmentFlag', () => {
  it.each(['1', 'true', 'YES', ' on '])('recognizes enabled value %j', (value) => {
    expect(environmentFlag(value)).toBe(true)
  })

  it.each(['0', 'false', 'NO', ' off '])('recognizes disabled value %j', (value) => {
    expect(environmentFlag(value, true)).toBe(false)
  })

  it('uses the fallback for missing or unrecognized values', () => {
    expect([environmentFlag(undefined, true), environmentFlag('other', true)]).toEqual([true, true])
  })
})
