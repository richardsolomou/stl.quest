import type { Repository } from './types'

export const onboardingTaskIds = ['printers', 'stock', 'upload', 'move', 'inspect', 'download', 'invite', 'tracking'] as const

export type OnboardingTaskId = (typeof onboardingTaskIds)[number]

export const onboardingSectionIds = ['getting-started', 'optional'] as const

export type OnboardingSectionId = (typeof onboardingSectionIds)[number]

export type OnboardingQuest = {
  id: OnboardingTaskId
  version: number
  points: number
  scope: 'user' | 'workspace'
  section: OnboardingSectionId
  prerequisites: readonly OnboardingTaskId[]
  requiresRequests?: boolean
  /** Who the quest is for; everyone when absent. */
  audience?: 'admin' | 'requester'
}

/** The setup that matters, in the order it pays off; requesters only add and inspect their own prints. */
export const onboardingQuests: readonly OnboardingQuest[] = [
  { id: 'printers', version: 1, points: 20, scope: 'workspace', section: 'getting-started', prerequisites: [], audience: 'admin' },
  { id: 'stock', version: 1, points: 10, scope: 'workspace', section: 'getting-started', prerequisites: [], audience: 'admin' },
  { id: 'upload', version: 1, points: 20, scope: 'user', section: 'getting-started', prerequisites: [] },
  {
    id: 'move',
    version: 2,
    points: 20,
    scope: 'user',
    section: 'getting-started',
    prerequisites: [],
    requiresRequests: true,
    audience: 'admin',
  },
  {
    id: 'inspect',
    version: 1,
    points: 10,
    scope: 'user',
    section: 'getting-started',
    prerequisites: ['upload'],
    requiresRequests: true,
    audience: 'requester',
  },
  {
    id: 'download',
    version: 1,
    points: 10,
    scope: 'user',
    section: 'getting-started',
    prerequisites: ['inspect'],
    requiresRequests: true,
    audience: 'requester',
  },
  { id: 'invite', version: 1, points: 20, scope: 'workspace', section: 'getting-started', prerequisites: [], audience: 'admin' },
  { id: 'tracking', version: 1, points: 10, scope: 'workspace', section: 'optional', prerequisites: [], audience: 'admin' },
]

export type OnboardingProgress = {
  completedTasks: OnboardingTaskId[]
  skippedTasks: OnboardingTaskId[]
  celebratedTasks: OnboardingTaskId[]
}

export type OnboardingProgressOperation =
  | { operation: 'complete' | 'skip' | 'restore'; task: OnboardingTaskId }
  | { operation: 'celebrate'; tasks: OnboardingTaskId[] }

export function normalizeOnboardingTasks(tasks: string[]): OnboardingTaskId[] {
  const known = new Set<string>(onboardingTaskIds)
  return [...new Set(tasks)].filter((task): task is OnboardingTaskId => known.has(task))
}

export function onboardingTaskScope(task: OnboardingTaskId) {
  return onboardingQuests.find((quest) => quest.id === task)!.scope
}

export function onboardingQuestVersion(quest: OnboardingQuest) {
  return `${quest.id}:${quest.version}`
}

export function applicableOnboardingQuests(isAdmin: boolean) {
  return onboardingQuests.filter((quest) => !quest.audience || quest.audience === (isAdmin ? 'admin' : 'requester'))
}

export function availableOnboardingQuests(quests: readonly OnboardingQuest[], progress: OnboardingProgress, hasRequests: boolean) {
  const resolved = new Set([...progress.completedTasks, ...progress.skippedTasks])
  return quests.filter(
    (quest) =>
      resolved.has(quest.id) || (quest.prerequisites.every((task) => resolved.has(task)) && (!quest.requiresRequests || hasRequests)),
  )
}

export function onboardingPoints(completedTasks: OnboardingTaskId[], applicableTasks: readonly OnboardingTaskId[]) {
  const completed = new Set(completedTasks)
  return onboardingQuests.reduce(
    (points, quest) => points + (applicableTasks.includes(quest.id) && completed.has(quest.id) ? quest.points : 0),
    0,
  )
}

export function applyOnboardingProgressOperation(current: OnboardingProgress, operation: OnboardingProgressOperation): OnboardingProgress {
  const completed = new Set(current.completedTasks)
  const skipped = new Set(current.skippedTasks)
  const celebrated = new Set(current.celebratedTasks)
  if (operation.operation === 'complete') {
    completed.add(operation.task)
    skipped.delete(operation.task)
  } else if (operation.operation === 'skip') {
    if (!completed.has(operation.task)) skipped.add(operation.task)
  } else if (operation.operation === 'restore') {
    skipped.delete(operation.task)
  } else if (operation.operation === 'celebrate') {
    for (const task of operation.tasks) celebrated.add(task)
  }
  return { completedTasks: [...completed], skippedTasks: [...skipped], celebratedTasks: [...celebrated] }
}

export async function recordOnboardingTask(
  repository: Pick<Repository, 'getUserOnboarding' | 'saveUserOnboarding'>,
  userId: string,
  task: OnboardingTaskId,
  workspaceId?: string,
) {
  const workspaceScoped = onboardingTaskScope(task) === 'workspace'
  if (workspaceScoped && !workspaceId) throw new Error(`workspace is required for onboarding task ${task}`)
  const scopedWorkspaceId = workspaceScoped ? workspaceId : undefined
  const current = await repository.getUserOnboarding(userId, scopedWorkspaceId)
  if (current.completedTasks.includes(task)) return current
  const next = applyOnboardingProgressOperation(current, { operation: 'complete', task })
  await repository.saveUserOnboarding(userId, next, scopedWorkspaceId)
  return next
}
