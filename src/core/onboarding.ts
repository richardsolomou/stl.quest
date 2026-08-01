import type { Repository } from './types'

export const onboardingQuests = [
  {
    id: 'upload',
    title: 'Add your first print',
    description: 'Add one or several STL files when you are ready to put work into the queue.',
    hint: 'You can also drag files anywhere onto the board.',
    advancedTip: 'Add several files together when they belong to the same batch of work.',
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
    hint: 'For multi-copy requests, STL Quest asks how many copies to move.',
    advancedTip: 'Move only some copies when a larger request is split across production stages.',
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
    hint: 'Select any card on the board.',
    advancedTip: 'The print view is also where you can download the model and edit request details.',
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
    hint: 'Open a print, then choose Download STL.',
    advancedTip: 'Select several cards to download their models together as a ZIP file.',
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
    hint: 'Right-click a card, or press and hold it on a touchscreen.',
    advancedTip: 'Select several cards before moving or deleting them as one batch.',
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
    hint: 'Sorting changes your view, not the underlying workflow.',
    advancedTip: 'Your chosen sort is remembered and can differ from other users’ views.',
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
    hint: 'Filtered views are reflected in the URL, so you can share them.',
    advancedTip: 'Combine filters, then copy the URL to share that exact view.',
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
    hint: 'Choose a preset or enter a custom printer, then save your changes.',
    advancedTip: 'Add every available machine so automatic assignment can distribute compatible work.',
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
    hint: 'Already-configured storage completes this quest automatically.',
    advancedTip: 'Storage can be moved later with verification while the original files remain as a fallback.',
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
    hint: 'Change Request visibility in Board settings.',
    advancedTip: 'Admins always retain a complete view of the workspace queue.',
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
    hint: 'Choose Invite user and create an invite link.',
    advancedTip: 'Invite links expire after seven days and can be revoked before use.',
    version: 1,
    points: 20,
    scope: 'workspace',
    section: 'workspace-setup',
    prerequisites: [],
    admin: true,
  },
] as const

export type OnboardingQuest = (typeof onboardingQuests)[number]
export type OnboardingTaskId = OnboardingQuest['id']
export type OnboardingSectionId = OnboardingQuest['section']

export const onboardingTaskIds = onboardingQuests.map((quest) => quest.id) as [OnboardingTaskId, ...OnboardingTaskId[]]

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
  return onboardingQuests.filter((quest) => !('admin' in quest) || !quest.admin || isAdmin)
}

export function availableOnboardingQuests(quests: readonly OnboardingQuest[], progress: OnboardingProgress, hasRequests: boolean) {
  const resolved = new Set([...progress.completedTasks, ...progress.skippedTasks])
  return quests.filter(
    (quest) =>
      resolved.has(quest.id) ||
      (quest.prerequisites.every((task) => resolved.has(task)) &&
        (!('requiresRequests' in quest) || !quest.requiresRequests || hasRequests)),
  )
}

export function onboardingPoints(completedTasks: OnboardingTaskId[], applicableTasks: readonly OnboardingTaskId[]) {
  const completed = new Set(completedTasks)
  return onboardingQuests.reduce(
    (points, quest) => points + (applicableTasks.includes(quest.id) && completed.has(quest.id) ? quest.points : 0),
    0,
  )
}

export async function recordOnboardingTask(
  repository: Pick<Repository, 'getUserOnboarding' | 'saveUserOnboarding' | 'workspaceId'>,
  userId: string,
  task: OnboardingTaskId,
  workspaceId = repository.workspaceId,
) {
  const scopedWorkspaceId = onboardingTaskScope(task) === 'workspace' ? workspaceId : undefined
  const current = await repository.getUserOnboarding(userId, scopedWorkspaceId)
  if (current.completedTasks.includes(task)) return current
  const next = {
    ...current,
    completedTasks: [...current.completedTasks, task],
    skippedTasks: current.skippedTasks.filter((candidate) => candidate !== task),
  }
  await repository.saveUserOnboarding(userId, next, scopedWorkspaceId)
  return next
}
