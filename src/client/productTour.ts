import { onboardingTaskIds, type OnboardingTaskId } from '../core/onboarding'

export const PRODUCT_TOUR_ID = 'onboarding-request-queue'
export const PRODUCT_TOUR_EVENT = 'stlquest:product-tour'
export const PRODUCT_TOUR_PROGRESS_EVENT = 'stlquest:product-tour-progress'

export type ProductTourProgress = {
  completedTasks: OnboardingTaskId[]
  snoozedUntil?: number
}

export function readProductTourProgress(storage: Storage, userId: string): ProductTourProgress {
  try {
    const value: unknown = JSON.parse(storage.getItem(productTourStorageKey(userId)) ?? '{}')
    if (!value || typeof value !== 'object') return { completedTasks: [] }
    const progress = value as { completedTasks?: unknown; snoozedUntil?: unknown }
    const storedTasks = Array.isArray(progress.completedTasks) ? progress.completedTasks : []
    const completedTasks = onboardingTaskIds.filter((task) => storedTasks.includes(task))
    return {
      completedTasks,
      snoozedUntil: typeof progress.snoozedUntil === 'number' ? progress.snoozedUntil : undefined,
    }
  } catch {
    return { completedTasks: [] }
  }
}

export function writeProductTourProgress(storage: Storage, userId: string, progress: ProductTourProgress) {
  storage.setItem(productTourStorageKey(userId), JSON.stringify(progress))
}

export function replayProductTour() {
  window.dispatchEvent(new Event(PRODUCT_TOUR_EVENT))
}

export function signalProductTourProgress(task: OnboardingTaskId) {
  window.dispatchEvent(new CustomEvent<OnboardingTaskId>(PRODUCT_TOUR_PROGRESS_EVENT, { detail: task }))
}

function productTourStorageKey(userId: string) {
  return `stlquest:tour-${PRODUCT_TOUR_ID}:${userId}`
}
