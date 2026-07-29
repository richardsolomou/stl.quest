import { describe, expect, it } from 'vitest'
import { errorHasCode } from './backend'

describe('database backend errors', () => {
  it('finds a nested driver code', () => {
    expect(errorHasCode(new Error('outer', { cause: { code: 'unique' } }), 'unique')).toBe(true)
  })

  it('rejects an unrelated driver code', () => {
    expect(errorHasCode({ code: 'other' }, 'unique')).toBe(false)
  })
})
