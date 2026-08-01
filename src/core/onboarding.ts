export const onboardingTaskIds = ['upload', 'move', 'actions', 'sort', 'filter', 'printers', 'storage'] as const

export type OnboardingTaskId = (typeof onboardingTaskIds)[number]

export type OnboardingProgress = {
  completedTasks: OnboardingTaskId[]
  snoozedUntil?: number
}

export function normalizeOnboardingTasks(tasks: string[]): OnboardingTaskId[] {
  const known = new Set<string>(onboardingTaskIds)
  return [...new Set(tasks)].filter((task): task is OnboardingTaskId => known.has(task))
}
