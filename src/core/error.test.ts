import { describe, expect, it } from 'vitest'
import { errorMessage } from './error'

describe('errorMessage', () => {
  it('returns an error message', () => {
    expect(errorMessage(new Error('Network unavailable'), 'Request failed.')).toBe('Network unavailable')
  })

  it('returns a message from non-Error response objects', () => {
    expect(errorMessage({ message: 'User already exists.' }, 'Could not create account.')).toBe('User already exists.')
  })

  it('returns the fallback when a message is unavailable', () => {
    expect(errorMessage({ status: 500 }, 'Request failed.')).toBe('Request failed.')
  })
})
