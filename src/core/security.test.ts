import { describe, expect, it } from 'vitest'
import { messagesFor } from './i18n'
import { PASSWORD_MIN_LENGTH, passwordLengthError } from './security'

describe('password length validation', () => {
  it('accepts the minimum length', () => {
    expect(passwordLengthError('x'.repeat(PASSWORD_MIN_LENGTH), messagesFor('en'))).toBeUndefined()
  })

  it('describes a password that is too short', () => {
    expect(passwordLengthError('x'.repeat(PASSWORD_MIN_LENGTH - 1), messagesFor('en'))).toBe(
      `Use at least ${PASSWORD_MIN_LENGTH} characters`,
    )
  })

  it('describes a short password in French', () => {
    expect(passwordLengthError('x'.repeat(PASSWORD_MIN_LENGTH - 1), messagesFor('fr'))).toBe(
      `Utilisez au moins ${PASSWORD_MIN_LENGTH} caractères`,
    )
  })
})
