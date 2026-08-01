import { onboardingTaskIds, type OnboardingTaskId } from '../core/onboarding'

export const PRODUCT_TOUR_ID = 'onboarding-request-queue'
export const PRODUCT_TOUR_EVENT = 'stlquest:product-tour'
export const PRODUCT_TOUR_PROGRESS_EVENT = 'stlquest:product-tour-progress'

export function replayProductTour() {
  window.dispatchEvent(new Event(PRODUCT_TOUR_EVENT))
}

export function signalProductTourProgress(task: OnboardingTaskId) {
  window.dispatchEvent(new CustomEvent<OnboardingTaskId>(PRODUCT_TOUR_PROGRESS_EVENT, { detail: task }))
}

export const productTourTaskIds = onboardingTaskIds
