import { describe, expect, it } from 'vitest'
import { fixedWindowLimiter } from './rateLimit'

describe('fixedWindowLimiter', () => {
  it('allows up to the limit in one window', () => {
    const take = fixedWindowLimiter(2, 60_000, () => 0)
    take('key')

    expect(take('key')).toEqual({ allowed: true })
  })

  it('refuses past the limit until the window ends', () => {
    const take = fixedWindowLimiter(1, 60_000, () => 15_000)
    take('key')

    expect(take('key')).toEqual({ allowed: false, retryAfterSeconds: 45 })
  })

  it('counts each key on its own', () => {
    const take = fixedWindowLimiter(1, 60_000, () => 0)
    take('one')

    expect(take('two').allowed).toBe(true)
  })

  it('starts counting again in the next window', () => {
    let now = 0
    const take = fixedWindowLimiter(1, 60_000, () => now)
    take('key')
    now = 60_000

    expect(take('key').allowed).toBe(true)
  })
})
