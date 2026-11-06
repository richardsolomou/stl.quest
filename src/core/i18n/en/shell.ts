import type { OnboardingSectionId, OnboardingTaskId } from '../../onboarding'

export const shell = {
  notFound: { title: 'Page not found', back: 'Back to the board' },
  rail: {
    goToBoard: 'Go to board',
    mainNavigation: 'Main navigation',
    board: 'Board',
    archive: 'Archive',
    calculator: 'Calculator',
    settings: 'Settings',
    storageAvailable: (size: string) => `${size} storage available`,
    includedStorage: 'Included storage',
    storageUsedOf: (quota: string) => `of ${quota} used`,
    storageFull: 'Storage is full, so new uploads will fail.',
    storageNearlyFull: 'Storage is nearly full.',
    upgradeTo: (plan: string) => `Upgrade to ${plan}`,
    viewPlan: 'View plan',
  },
  setup: {
    steps: { storage: 'Storage', printers: 'Printers' },
    stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
    progressLabel: (step: number, total: number, name: string) => `Setup step ${step} of ${total}: ${name}`,
  },
  tour: {
    questComplete: (title: string) => `${title} complete`,
    xpEarned: (points: number) => `+${points} XP earned`,
    viewOnboarding: 'View onboarding',
    newQuestsAvailable: (count: number) => `${count} new STL Quest${count === 1 ? '' : 's'} available.`,
    triggerLabel: (resolved: number, total: number, points: number, newCount: number) =>
      `STL Quest, ${resolved} of ${total} resolved, ${points} XP${newCount ? `, ${newCount} new` : ''}`,
    allComplete: 'STL Quest complete',
    newQuests: (count: number) => `${count} new quests`,
    completeYourQuest: 'Complete your STL Quest',
    readyForNext: 'Ready for the next quest',
    learnByDoing: 'Learn by doing',
    xp: (points: number) => `${points} XP`,
    progress: (resolved: number, total: number, points: number, totalPoints: number) =>
      `${resolved} of ${total} quests resolved · ${points} of ${totalPoints} XP earned`,
    summary: (completed: number, skipped: number) => `${completed} completed · ${skipped} skipped`,
    reviewQuests: 'Review quests',
    rowComplete: 'Complete · Review',
    rowSkipped: 'Skipped',
    rowPoints: (points: number, isNew: boolean) => `${isNew ? 'New · ' : ''}${points} XP`,
    restore: (title: string) => `Restore ${title}`,
    skip: (title: string) => `Skip ${title}`,
    notForMe: 'Not for me',
    promptLabel: 'STL Quest',
    promptHeading: (points: number) => `STL Quest · +${points} XP`,
    closePrompt: 'Close onboarding prompt',
  },
  onboarding: {
    sections: {
      'getting-started': 'Getting started',
      'managing-queue': 'Managing the queue',
      'workspace-setup': 'Configuring your workspace',
    } satisfies Record<OnboardingSectionId, string>,
    quests: {
      upload: {
        title: 'Add your first print',
        description: 'Upload a model or save a source link when you are ready to put work into the queue.',
      },
      move: { title: 'Move work through the queue', description: 'Drag a print card between columns to update its stage.' },
      inspect: { title: 'Inspect a print', description: 'Open a print card to review its model, notes, copies, and assignment.' },
      download: { title: 'Download a model', description: 'Download an STL from a print card or its detail view.' },
      actions: { title: 'Discover print actions', description: 'Use a print card action to select, group, move, or delete work.' },
      sort: { title: 'Choose your queue view', description: 'Sort by requester priority, submission time, name, or recent activity.' },
      filter: {
        title: 'Find work with filters',
        description: 'Apply a filter to focus the queue by print type, requester, dates, files, or another useful field.',
      },
      printers: {
        title: 'Assemble your printer fleet',
        description: 'Add and save a printer profile to help match requests to compatible machines.',
      },
      storage: {
        title: 'Inspect model storage',
        description: 'Review the active storage provider and the options for moving models later.',
      },
      visibility: {
        title: 'Choose request visibility',
        description: 'Choose whether requesters see the shared queue or only their own work.',
      },
      invite: { title: 'Invite a teammate', description: 'Create a single-use invite for a requester or another admin.' },
    } satisfies Record<OnboardingTaskId, { title: string; description: string }>,
  },
  confirm: {
    noDetail: 'No further detail was returned.',
  },
  query: {
    requestFailed: 'The request failed. Check your connection and try again.',
    retry: 'Retry',
    mutationFailed: 'Something went wrong. Please try again.',
    staleServerFunction: 'STL Quest has been updated. Refresh the page to continue.',
  },
  routeError: {
    body: 'The server could not load this page. Refresh to try again, then check the server logs if it continues.',
    refresh: 'Refresh',
  },
  release: {
    available: (version: string) => `STL Quest v${version} is available.`,
    viewWhatsNew: 'View what’s new',
    viewRelease: 'View release',
  },
  updates: {
    couldNotLoad: 'STL Quest couldn’t finish loading.',
    updated: 'STL Quest has been updated.',
    refresh: 'Refresh',
  },
  copyValue: (label: string) => `Copy ${label}`,
  datePicker: {
    clearDate: 'Clear date',
  },
  ui: {
    loading: 'Loading',
    columns: 'Columns',
    itemCount: (count: number, label: string) => `${count} ${label}`,
    perPage: (size: number) => `${size} per page`,
    itemsPerPage: (items: string) => `${items.charAt(0).toUpperCase()}${items.slice(1)} per page`,
    pageOf: (page: number, total: number) => `Page ${page} of ${total}`,
    previous: 'Previous',
    next: 'Next',
  },
}
