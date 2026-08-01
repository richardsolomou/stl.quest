import { describe, expect, it, vi } from 'vitest'
import {
  applicableOnboardingQuests,
  availableOnboardingQuests,
  normalizeOnboardingTasks,
  onboardingPoints,
  recordOnboardingTask,
  type OnboardingProgress,
} from './onboarding'

describe('onboarding tasks', () => {
  it('keeps known tasks once and in completion order', () => {
    expect(normalizeOnboardingTasks(['upload', 'unknown', 'move', 'upload'])).toEqual(['upload', 'move'])
  })

  it('only awards points for completed applicable tasks', () => {
    expect(onboardingPoints(['upload', 'move', 'storage'], ['upload', 'sort', 'storage'])).toBe(30)
  })

  it('reveals queue quests only when work exists and unlocks actions after a move', () => {
    const progress: OnboardingProgress = { completedTasks: ['upload'], skippedTasks: [], celebratedTasks: [] }
    const admin = applicableOnboardingQuests(true)

    expect(availableOnboardingQuests(admin, progress, false).map((quest) => quest.id)).toEqual(['upload', 'printers', 'storage'])
    expect(availableOnboardingQuests(admin, progress, true).map((quest) => quest.id)).toEqual([
      'upload',
      'move',
      'sort',
      'filter',
      'printers',
      'storage',
    ])

    progress.completedTasks.push('move')
    expect(availableOnboardingQuests(admin, progress, true).map((quest) => quest.id)).toContain('actions')
  })

  it('records successful actions and restores a previously skipped quest', async () => {
    const current: OnboardingProgress = { completedTasks: [], skippedTasks: ['upload'], celebratedTasks: [] }
    const saveUserOnboarding = vi.fn()

    await recordOnboardingTask({ getUserOnboarding: vi.fn().mockResolvedValue(current), saveUserOnboarding }, 'maker', 'upload')

    expect(saveUserOnboarding).toHaveBeenCalledWith('maker', {
      completedTasks: ['upload'],
      skippedTasks: [],
      celebratedTasks: [],
    })
  })
})
