import { describe, expect, it } from 'vitest'
import { inviteIsActive } from './invites'

describe('inviteIsActive', () => {
  it('accepts an unused invite before expiry', () => {
    expect(inviteIsActive({ expiresAt: 2 }, 1)).toBe(true)
  })

  it('rejects used and expired invites', () => {
    expect([inviteIsActive({ expiresAt: 2, usedAt: 1 }, 1), inviteIsActive({ expiresAt: 1 }, 1)]).toEqual([false, false])
  })
})
