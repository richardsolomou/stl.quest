import { describe, expect, it } from 'vitest'
import { needsStorageOnboarding } from './onboarding'

describe('storage onboarding', () => {
  it('does not restart onboarding when configured storage is temporarily unavailable', () => {
    expect(needsStorageOnboarding(true)).toBe(false)
  })

  it('starts onboarding when storage has never been configured', () => {
    expect(needsStorageOnboarding(false)).toBe(true)
  })
})
