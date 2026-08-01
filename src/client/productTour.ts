import type { OnboardingTaskId } from '../core/onboarding'

export const PRODUCT_TOUR_ID = 'onboarding-request-queue'
export const PRODUCT_QUEST_EVENT = 'stlquest:product-quest'
export const PRODUCT_TOUR_PROGRESS_EVENT = 'stlquest:product-tour-progress'

export function openProductQuest() {
  window.dispatchEvent(new Event(PRODUCT_QUEST_EVENT))
}

export function signalProductTourProgress(task: OnboardingTaskId) {
  window.dispatchEvent(new CustomEvent<OnboardingTaskId>(PRODUCT_TOUR_PROGRESS_EVENT, { detail: task }))
}
