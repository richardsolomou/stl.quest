import type { OnboardingSectionId, OnboardingTaskId } from '../../onboarding'
import type { PrintType } from '../../types'

type QuestCopy = { title: string; description: string }

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
    updateAvailable: (version: string) => `STL Quest v${version} is available`,
  },
  settingsNav: {
    label: 'Settings sections',
    choose: 'Choose a settings section',
    workspace: 'Workspace',
    production: 'Production',
    connections: 'Connections',
    you: 'You',
    server: 'Server',
    product: 'STL Quest',
    account: 'Account',
    plan: 'Plan',
    about: 'About',
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
    rowComplete: 'Done',
    showResolved: (count: number) => `Show ${count} resolved`,
    hideResolved: 'Hide resolved',
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
      optional: 'Optional',
    } satisfies Record<OnboardingSectionId, string>,
    quests: {
      printers: {
        title: 'Add your printers',
        description: 'Add each printer you run, so prints are matched to one that fits and quotes use what it costs to run.',
      },
      stock: {
        resin: {
          title: 'Add the resins you stock',
          description: 'Optional. Add the resins you print with and what you pay, so quotes use your prices.',
        },
        filament: {
          title: 'Add the filaments you stock',
          description: 'Optional. Add the filaments you print with and what you pay, so quotes use your prices.',
        },
        both: {
          title: 'Add the materials you stock',
          description: 'Optional. Add the resins and filaments you print with and what you pay, so quotes use your prices.',
        },
      },
      upload: {
        title: 'Add your first print',
        description: 'Upload a model or save a link to put work in the queue.',
      },
      move: {
        title: 'Get a print to Ready',
        description: 'Drag a print card from the queue through Printing and Finishing to Ready.',
      },
      inspect: { title: 'Inspect a print', description: 'Open a print card to review its model, notes, copies, and assignment.' },
      download: { title: 'Download a model', description: 'Download an STL from a print card or its detail view.' },
      invite: { title: 'Invite your team', description: 'Create a single-use invite for a requester or another admin.' },
      tracking: {
        title: 'Track usage and stock',
        description:
          'Optional. Answer what each print used as it moves, and stock levels, reorders, part wear, and spend count themselves. Turn it on here.',
      },
    } satisfies Record<Exclude<OnboardingTaskId, 'stock'>, QuestCopy> & { stock: Record<PrintType | 'both', QuestCopy> },
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
