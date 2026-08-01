import { describe, expect, it } from 'vitest'
import { normalizeOnboardingTasks, onboardingPoints } from './onboarding'

describe('onboarding tasks', () => {
  it('keeps known tasks once and in completion order', () => {
    expect(normalizeOnboardingTasks(['upload', 'unknown', 'move', 'upload'])).toEqual(['upload', 'move'])
  })

  it('only awards points for completed applicable tasks', () => {
    expect(onboardingPoints(['upload', 'move', 'storage'], ['upload', 'sort', 'storage'])).toBe(30)
  })
})
