export const onboardingTaskIds = ['upload', 'move', 'actions', 'sort', 'filter', 'printers', 'storage'] as const

export type OnboardingTaskId = (typeof onboardingTaskIds)[number]

export type OnboardingProgress = {
  completedTasks: OnboardingTaskId[]
  skippedTasks: OnboardingTaskId[]
  celebratedTasks: OnboardingTaskId[]
}

export function normalizeOnboardingTasks(tasks: string[]): OnboardingTaskId[] {
  const known = new Set<string>(onboardingTaskIds)
  return [...new Set(tasks)].filter((task): task is OnboardingTaskId => known.has(task))
}

export function onboardingPoints(completedTasks: OnboardingTaskId[], applicableTasks: readonly OnboardingTaskId[]) {
  const completed = new Set(completedTasks)
  return applicableTasks.reduce((points, task) => points + (completed.has(task) ? onboardingTaskPoints[task] : 0), 0)
}

export const onboardingTaskPoints: Record<OnboardingTaskId, number> = {
  upload: 20,
  move: 20,
  actions: 10,
  sort: 10,
  filter: 10,
  printers: 20,
  storage: 10,
}
