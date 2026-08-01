import { describe, expect, it } from 'vitest'
import { signInFailureMessage, signInFailureReason } from './auth'

describe('signInFailureReason', () => {
  it('classifies the rate limiter (429) so retries are not blamed on the password', () => {
    expect(signInFailureReason({ status: 429 })).toBe('rate_limited')
    expect(signInFailureReason({ status: 429, code: 'INVALID_EMAIL_OR_PASSWORD' })).toBe('rate_limited')
  })

  it('classifies genuinely bad credentials', () => {
    expect(signInFailureReason({ status: 401 })).toBe('invalid_credentials')
    expect(signInFailureReason({ code: 'INVALID_EMAIL_OR_PASSWORD' })).toBe('invalid_credentials')
  })

  it('classifies transport and server faults as an unexpected error', () => {
    expect(signInFailureReason({ status: 500 })).toBe('error')
    expect(signInFailureReason({})).toBe('error')
    expect(signInFailureReason(null)).toBe('error')
    expect(signInFailureReason(undefined)).toBe('error')
  })
})

describe('signInFailureMessage', () => {
  it('tells a rate-limited user to wait rather than that their password is wrong', () => {
    expect(signInFailureMessage({ status: 429 })).toBe('Too many sign-in attempts. Wait a minute, then try again.')
  })

  it('keeps the credential message for a real 401', () => {
    expect(signInFailureMessage({ status: 401 })).toBe('Email or password is incorrect.')
  })

  it('surfaces the server message for other failures instead of a wrong-password lie', () => {
    expect(signInFailureMessage({ status: 503, message: 'Service unavailable.' })).toBe('Service unavailable.')
    expect(signInFailureMessage({ status: 500 })).toBe('Something went wrong signing in. Try again.')
  })
})
