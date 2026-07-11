import { describe, expect, it } from 'vitest'
import { ConnectionLimiter } from './connections'

describe('ConnectionLimiter', () => {
  it('caps event streams globally and per identity and releases exactly once', () => {
    const limiter = new ConnectionLimiter(2, 1)
    const first = limiter.enter('one')
    expect(first).toBeTypeOf('function')
    expect(limiter.enter('one')).toBeUndefined()
    const second = limiter.enter('two')
    expect(second).toBeTypeOf('function')
    expect(limiter.enter('three')).toBeUndefined()
    first!(); first!()
    expect(limiter.enter('three')).toBeTypeOf('function')
    second!()
  })
})
