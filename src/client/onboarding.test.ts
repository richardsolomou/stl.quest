import { describe, expect, it } from 'vitest'
import { storageSetupState } from './onboarding'

describe('storage onboarding', () => {
  it('distinguishes unavailable configured storage from incomplete setup', () => {
    expect(storageSetupState(true, false)).toBe('unavailable')
  })
})
