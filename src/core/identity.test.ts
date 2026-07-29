import { describe, expect, it } from 'vitest'
import { normalizeEmail } from './identity'

describe('normalizeEmail', () => {
  it('trims and lowercases email addresses', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com')
  })
})
