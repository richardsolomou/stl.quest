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
    expect(onboardingPoints(['upload', 'move', 'printers'], ['upload', 'inspect', 'printers'])).toBe(40)
  })

  it('versions announcements without changing persistent task IDs', () => {
    expect(onboardingQuestVersion(onboardingQuests.find((quest) => quest.id === 'upload')!)).toBe('upload:1')
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

  it('leads an admin through setup, a first print, and inviting people, with tracking last', () => {
    const progress: OnboardingProgress = { completedTasks: [], skippedTasks: [], celebratedTasks: [] }

    expect(availableOnboardingQuests(applicableOnboardingQuests(true), progress, false).map((quest) => quest.id)).toEqual([
      'printers',
      'stock',
      'upload',
      'invite',
      'tracking',
    ])
  })

  it('offers an admin the first print through the board once work exists', () => {
    const progress: OnboardingProgress = { completedTasks: [], skippedTasks: [], celebratedTasks: [] }

    expect(availableOnboardingQuests(applicableOnboardingQuests(true), progress, true).map((quest) => quest.id)).toContain('move')
  })

  it('keeps tracking in its own optional section', () => {
    expect(onboardingQuests.find((quest) => quest.id === 'tracking')?.section).toBe('optional')
  })

  it('gives a requester only their own steps', () => {
    const progress: OnboardingProgress = { completedTasks: ['upload', 'inspect'], skippedTasks: [], celebratedTasks: [] }

    expect(availableOnboardingQuests(applicableOnboardingQuests(false), progress, true).map((quest) => quest.id)).toEqual([
      'upload',
      'inspect',
      'download',
    ])
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

    await expect(recordOnboardingTask(repository, 'maker', 'printers')).rejects.toThrow(
      'workspace is required for onboarding task printers',
    )
  })
})
