import { describe, expect, it, vi } from 'vitest'
import {
  applyOnboardingProgressOperation,
  applicableOnboardingQuests,
  availableOnboardingQuests,
  normalizeOnboardingTasks,
  onboardingPoints,
  onboardingQuestVersion,
  onboardingQuests,
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

  it('versions announcements without changing persistent task IDs', () => {
    expect(onboardingQuestVersion(onboardingQuests[0])).toBe('upload:1')
  })

  it('applies skip, restore, completion, and celebration consistently', () => {
    const initial: OnboardingProgress = { completedTasks: [], skippedTasks: [], celebratedTasks: [] }
    const skipped = applyOnboardingProgressOperation(initial, { operation: 'skip', task: 'upload' })
    const restored = applyOnboardingProgressOperation(skipped, { operation: 'restore', task: 'upload' })
    const completed = applyOnboardingProgressOperation(restored, { operation: 'complete', task: 'upload' })

    expect(applyOnboardingProgressOperation(completed, { operation: 'celebrate', tasks: ['upload'] })).toEqual({
      completedTasks: ['upload'],
      skippedTasks: [],
      celebratedTasks: ['upload'],
    })
  })

  it('reveals queue quests only when work exists and unlocks actions after a move', () => {
    const progress: OnboardingProgress = { completedTasks: ['upload'], skippedTasks: [], celebratedTasks: [] }
    const admin = applicableOnboardingQuests(true)

    expect(availableOnboardingQuests(admin, progress, false).map((quest) => quest.id)).toEqual([
      'upload',
      'printers',
      'storage',
      'visibility',
      'invite',
    ])
    expect(availableOnboardingQuests(admin, progress, true).map((quest) => quest.id)).toEqual([
      'upload',
      'move',
      'inspect',
      'sort',
      'filter',
      'printers',
      'storage',
      'visibility',
      'invite',
    ])

    progress.completedTasks.push('move')
    expect(availableOnboardingQuests(admin, progress, true).map((quest) => quest.id)).toContain('actions')
  })

  it('records successful actions and restores a previously skipped quest', async () => {
    const current: OnboardingProgress = { completedTasks: [], skippedTasks: ['upload'], celebratedTasks: [] }
    const saveUserOnboarding = vi.fn()

    await recordOnboardingTask({ getUserOnboarding: vi.fn().mockResolvedValue(current), saveUserOnboarding }, 'maker', 'upload')

    expect(saveUserOnboarding).toHaveBeenCalledWith(
      'maker',
      {
        completedTasks: ['upload'],
        skippedTasks: [],
        celebratedTasks: [],
      },
      undefined,
    )
  })

  it('scopes workspace setup progress to the active workspace', async () => {
    const current: OnboardingProgress = { completedTasks: ['upload'], skippedTasks: [], celebratedTasks: [] }
    const getUserOnboarding = vi.fn().mockResolvedValue(current)
    const saveUserOnboarding = vi.fn()

    await recordOnboardingTask({ getUserOnboarding, saveUserOnboarding }, 'maker', 'printers', 'workspace-a')

    expect(getUserOnboarding).toHaveBeenCalledWith('maker', 'workspace-a')
    expect(saveUserOnboarding).toHaveBeenCalledWith(
      'maker',
      { completedTasks: ['upload', 'printers'], skippedTasks: [], celebratedTasks: [] },
      'workspace-a',
    )
  })

  it('requires workspace context for workspace-scoped progress', async () => {
    const repository = { getUserOnboarding: vi.fn(), saveUserOnboarding: vi.fn() }

    await expect(recordOnboardingTask(repository, 'maker', 'storage')).rejects.toThrow('workspace is required for onboarding task storage')
  })
})
