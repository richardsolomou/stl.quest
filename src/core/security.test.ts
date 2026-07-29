import { describe, expect, it } from 'vitest'
import { PASSWORD_MIN_LENGTH, passwordLengthError } from './security'

describe('password length validation', () => {
  it('accepts the minimum length', () => {
    expect(passwordLengthError('x'.repeat(PASSWORD_MIN_LENGTH))).toBeUndefined()
  })

  it('describes a password that is too short', () => {
    expect(passwordLengthError('x'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(`Use at least ${PASSWORD_MIN_LENGTH} characters`)
  })
})
