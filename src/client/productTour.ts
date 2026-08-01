import type { OnboardingTaskId } from '../core/onboarding'

export const PRODUCT_TOUR_ID = 'onboarding-request-queue'
export const PRODUCT_QUEST_EVENT = 'stlquest:product-quest'
export const PRODUCT_TOUR_PROGRESS_EVENT = 'stlquest:product-tour-progress'

export type ProductTourProgress = { task: OnboardingTaskId; target?: string }

export function openProductQuest() {
  window.dispatchEvent(new Event(PRODUCT_QUEST_EVENT))
}

export function signalProductTourProgress(task: OnboardingTaskId, target?: string) {
  window.dispatchEvent(new CustomEvent<ProductTourProgress>(PRODUCT_TOUR_PROGRESS_EVENT, { detail: { task, target } }))
}
