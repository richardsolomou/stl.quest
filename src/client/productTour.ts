import type { Step } from 'react-joyride'
import type { Messages } from '../core/i18n'
import type { OnboardingTaskId } from '../core/onboarding'
import { printTypeCopy } from '../core/printTypes'
import type { PrintType } from '../core/types'

export const PRODUCT_TOUR_ID = 'onboarding-request-queue'
export const PRODUCT_QUEST_EVENT = 'stlquest:product-quest'
export const PRODUCT_TOUR_PROGRESS_EVENT = 'stlquest:product-tour-progress'

export type ProductTourPage = 'board' | 'board-settings' | 'printers' | 'consumables' | 'users'
export const PRODUCT_QUEST_UI: Record<OnboardingTaskId, { target: string; page: ProductTourPage; placement?: Step['placement'] }> = {
  printers: { target: 'printers', page: 'printers', placement: 'top' },
  stock: { target: 'consumables-add', page: 'consumables', placement: 'bottom-end' },
  upload: { target: 'upload', page: 'board', placement: 'bottom-start' },
  move: { target: 'request-card', page: 'board', placement: 'right' },
  inspect: { target: 'request-card', page: 'board', placement: 'right' },
  download: { target: 'request-card', page: 'board', placement: 'right' },
  invite: { target: 'invite', page: 'users', placement: 'top' },
  tracking: { target: 'tracking', page: 'board-settings', placement: 'bottom' },
}

/** A quest's title and description; what to stock names the materials the workspace prints. */
export function questCopy(quests: Messages['shell']['onboarding']['quests'], task: OnboardingTaskId, printTypes: PrintType[]) {
  return task === 'stock' ? quests.stock[printTypeCopy(printTypes)] : quests[task]
}

export type ProductTourProgress = { task: OnboardingTaskId }

export function openProductQuest() {
  window.dispatchEvent(new Event(PRODUCT_QUEST_EVENT))
}

export function signalProductTourProgress(task: OnboardingTaskId) {
  window.dispatchEvent(new CustomEvent<ProductTourProgress>(PRODUCT_TOUR_PROGRESS_EVENT, { detail: { task } }))
}

export function productTourPage(pathname: string): ProductTourPage | undefined {
  if (pathname === '/') return 'board'
  if (pathname === '/settings/board') return 'board-settings'
  if (pathname === '/settings/printers') return 'printers'
  if (pathname === '/settings/consumables') return 'consumables'
  if (pathname === '/settings/users') return 'users'
  return undefined
}
