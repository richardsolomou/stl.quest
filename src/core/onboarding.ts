import type { Repository } from './types'

export const onboardingTaskIds = [
  'upload',
  'move',
  'inspect',
  'download',
  'actions',
  'sort',
  'filter',
  'printers',
  'storage',
  'visibility',
  'invite',
] as const

export type OnboardingTaskId = (typeof onboardingTaskIds)[number]
export type OnboardingSectionId = 'getting-started' | 'managing-queue' | 'workspace-setup'
export type OnboardingQuest = {
  id: OnboardingTaskId
  title: string
  description: string
  version: number
  points: number
  scope: 'user' | 'workspace'
  section: OnboardingSectionId
  prerequisites: readonly OnboardingTaskId[]
  requiresRequests?: boolean
  admin?: boolean
}

export const onboardingQuests: readonly OnboardingQuest[] = [
  {
    id: 'upload',
    title: 'Add your first print',
    description: 'Upload a model or save a source link when you are ready to put work into the queue.',
    version: 1,
    points: 20,
    scope: 'user',
    section: 'getting-started',
    prerequisites: [],
  },
  {
    id: 'move',
    title: 'Move work through the queue',
    description: 'Drag a print card between columns to update its stage.',
    version: 1,
    points: 20,
    scope: 'user',
    section: 'managing-queue',
    prerequisites: [],
    requiresRequests: true,
    admin: true,
  },
  {
    id: 'inspect',
    title: 'Inspect a print',
    description: 'Open a print card to review its model, notes, copies, and assignment.',
    version: 1,
    points: 10,
    scope: 'user',
    section: 'managing-queue',
    prerequisites: ['upload'],
    requiresRequests: true,
  },
  {
    id: 'download',
    title: 'Download a model',
    description: 'Download an STL from a print card or its detail view.',
    version: 1,
    points: 10,
    scope: 'user',
    section: 'managing-queue',
    prerequisites: ['inspect'],
    requiresRequests: true,
  },
  {
    id: 'actions',
    title: 'Discover print actions',
    description: 'Use a print card action to select, group, move, or delete work.',
    version: 1,
    points: 10,
    scope: 'user',
    section: 'managing-queue',
    prerequisites: ['move'],
    requiresRequests: true,
    admin: true,
  },
  {
    id: 'sort',
    title: 'Choose your queue view',
    description: 'Sort by requester priority, submission time, name, or recent activity.',
    version: 1,
    points: 10,
    scope: 'user',
    section: 'managing-queue',
    prerequisites: [],
    requiresRequests: true,
  },
  {
    id: 'filter',
    title: 'Find work with filters',
    description: 'Apply a filter to focus the queue by print type, requester, dates, files, or another useful field.',
    version: 1,
    points: 10,
    scope: 'user',
    section: 'managing-queue',
    prerequisites: [],
    requiresRequests: true,
  },
  {
    id: 'printers',
    title: 'Assemble your printer fleet',
    description: 'Add and save a printer profile to help match requests to compatible machines.',
    version: 1,
    points: 20,
    scope: 'workspace',
    section: 'workspace-setup',
    prerequisites: ['upload'],
    admin: true,
  },
  {
    id: 'storage',
    title: 'Inspect model storage',
    description: 'Review the active storage provider and the options for moving models later.',
    version: 1,
    points: 10,
    scope: 'workspace',
    section: 'workspace-setup',
    prerequisites: ['upload'],
    admin: true,
  },
  {
    id: 'visibility',
    title: 'Choose request visibility',
    description: 'Choose whether requesters see the shared queue or only their own work.',
    version: 1,
    points: 10,
    scope: 'workspace',
    section: 'workspace-setup',
    prerequisites: [],
    admin: true,
  },
  {
    id: 'invite',
    title: 'Invite a teammate',
    description: 'Create a single-use invite for a requester or another admin.',
    version: 1,
    points: 20,
    scope: 'workspace',
    section: 'workspace-setup',
    prerequisites: [],
    admin: true,
  },
]

export const onboardingSections: { id: OnboardingSectionId; title: string }[] = [
  { id: 'getting-started', title: 'Getting started' },
  { id: 'managing-queue', title: 'Managing the queue' },
  { id: 'workspace-setup', title: 'Configuring your workspace' },
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
  return onboardingQuests.filter((quest) => !quest.admin || isAdmin)
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
