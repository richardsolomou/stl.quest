import { describe, expect, it } from 'vitest'
import { authFailureMessage, classifyAuthCallbackFailure, classifySignInFailure } from './authFailures'

describe('classifySignInFailure', () => {
  it('puts rate limiting before a credential code', () => {
    expect(classifySignInFailure({ status: 429, code: 'INVALID_EMAIL_OR_PASSWORD' })).toBe('rate_limited')
  })

  it.each([{ status: 401 }, { code: 'INVALID_EMAIL_OR_PASSWORD' }])('recognizes wrong credentials in %o', (failure) => {
    expect(classifySignInFailure(failure)).toBe('invalid_credentials')
  })

  it.each([undefined, { status: 500 }])('classifies %o as a general error', (failure) => {
    expect(classifySignInFailure(failure)).toBe('error')
  })
})

describe('classifyAuthCallbackFailure', () => {
  it.each([
    ['access_denied', 'cancelled'],
    ['user_cancelled_authorize', 'cancelled'],
    ['account_not_linked', 'account_not_linked'],
    ['unable_to_link_account', 'account_not_linked'],
    ['email_does_not_match', 'email_mismatch'],
    ['account_already_linked_to_different_user', 'account_already_linked'],
    ['SOCIAL_ACCOUNT_ALREADY_LINKED', 'account_already_linked'],
    ['INVALID_TOKEN', 'invalid_token'],
    ['TOKEN_EXPIRED', 'token_expired'],
    ['provider_error', 'error'],
    [undefined, 'error'],
  ])('classifies %s as %s', (error, reason) => {
    expect(classifyAuthCallbackFailure(error)).toBe(reason)
  })
})

describe('authFailureMessage', () => {
  it("uses Better Auth's message", () => {
    expect(authFailureMessage({ message: 'Account disabled.' }, 'fallback')).toBe('Account disabled.')
  })

  it('falls back when the message is blank', () => {
    expect(authFailureMessage({ message: ' ' }, 'fallback')).toBe('fallback')
  })
})
