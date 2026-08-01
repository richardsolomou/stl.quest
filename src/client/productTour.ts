import type { Step } from 'react-joyride'
import type { OnboardingTaskId } from '../core/onboarding'

export const PRODUCT_TOUR_ID = 'onboarding-request-queue'
export const PRODUCT_QUEST_EVENT = 'stlquest:product-quest'
export const PRODUCT_TOUR_PROGRESS_EVENT = 'stlquest:product-tour-progress'

export type ProductTourPage = 'board' | 'board-settings' | 'printers' | 'storage' | 'users'
export const PRODUCT_QUEST_UI: Record<OnboardingTaskId, { target: string; page: ProductTourPage; placement?: Step['placement'] }> = {
  upload: { target: 'upload', page: 'board', placement: 'bottom-start' },
  move: { target: 'request-card', page: 'board', placement: 'right' },
  inspect: { target: 'request-card', page: 'board', placement: 'right' },
  download: { target: 'request-card', page: 'board', placement: 'right' },
  actions: { target: 'request-card', page: 'board', placement: 'right' },
  sort: { target: 'sort', page: 'board', placement: 'bottom-end' },
  filter: { target: 'filters', page: 'board', placement: 'bottom-end' },
  printers: { target: 'printers', page: 'printers', placement: 'top' },
  storage: { target: 'storage', page: 'storage', placement: 'top' },
  visibility: { target: 'visibility', page: 'board-settings', placement: 'bottom' },
  invite: { target: 'invite', page: 'users', placement: 'top' },
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
  if (pathname === '/settings/storage') return 'storage'
  if (pathname === '/settings/users') return 'users'
  return undefined
}
