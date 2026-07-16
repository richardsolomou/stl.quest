import { describe, expect, it } from 'vitest'
import { authErrorMessage } from './authError'

describe('auth API errors', () => {
  it('shows the message returned by the API', () => {
    expect(authErrorMessage({ message: 'User already exists. Use another email.' }, 'Could not create account.')).toBe(
      'User already exists. Use another email.',
    )
  })

  it('falls back when the API does not return a message', () => {
    expect(authErrorMessage({ status: 500 }, 'Could not create account.')).toBe('Could not create account.')
  })
})
