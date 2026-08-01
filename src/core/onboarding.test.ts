import { describe, expect, it } from 'vitest'
import { normalizeOnboardingTasks } from './onboarding'

describe('onboarding tasks', () => {
  it('keeps known tasks once and in completion order', () => {
    expect(normalizeOnboardingTasks(['upload', 'unknown', 'move', 'upload'])).toEqual(['upload', 'move'])
  })
})
