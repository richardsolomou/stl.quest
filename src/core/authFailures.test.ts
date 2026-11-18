import { describe, expect, it } from 'vitest'
import { classifySignInFailure } from './authFailures'

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
