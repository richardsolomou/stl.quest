import { describe, expect, it } from 'vitest'
import { boundedUserName, MAX_USER_NAME_LENGTH, normalizeEmail } from './identity'

describe('normalizeEmail', () => {
  it('trims and lowercases email addresses', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com')
  })
})

describe('user names', () => {
  it('keeps a name within the limit unchanged', () => {
    expect(boundedUserName('a'.repeat(MAX_USER_NAME_LENGTH))).toBe('a'.repeat(MAX_USER_NAME_LENGTH))
  })

  it('cuts a longer name to the limit', () => {
    expect(boundedUserName('a'.repeat(MAX_USER_NAME_LENGTH + 1))).toBe('a'.repeat(MAX_USER_NAME_LENGTH))
  })

  it('cuts by characters rather than splitting one', () => {
    expect(boundedUserName('😀'.repeat(MAX_USER_NAME_LENGTH + 1))).toBe('😀'.repeat(MAX_USER_NAME_LENGTH))
  })
})
