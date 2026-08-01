export const PRODUCT_TOUR_EVENT = 'stlquest:product-tour'
export const PRODUCT_TOUR_PROGRESS_EVENT = 'stlquest:product-tour-progress'
export const PRODUCT_TOUR_SNOOZE_MS = 24 * 60 * 60 * 1000

export type ProductTourTask = 'upload' | 'move' | 'actions'
export type ProductTourState = {
  status: 'active' | 'snoozed' | 'dismissed'
  completed: ProductTourTask[]
  until?: number
}

function key(identityId: string) {
  return `stlquest:product-tour:v2:${identityId}`
}

export function productTourState(identityId: string, now = Date.now()): ProductTourState {
  const saved = localStorage.getItem(key(identityId))
  if (!saved) return { status: 'active', completed: [] }
  try {
    const state = JSON.parse(saved) as ProductTourState
    if (state.status === 'snoozed' && (state.until ?? 0) <= now) return { ...state, status: 'active' }
    return state
  } catch {
    return { status: 'active', completed: [] }
  }
}

export function saveProductTourState(identityId: string, state: ProductTourState) {
  localStorage.setItem(key(identityId), JSON.stringify(state))
}

export function snoozeProductTour(identityId: string, completed: ProductTourTask[], now = Date.now()) {
  saveProductTourState(identityId, { status: 'snoozed', completed, until: now + PRODUCT_TOUR_SNOOZE_MS })
}

export function dismissProductTour(identityId: string, completed: ProductTourTask[]) {
  saveProductTourState(identityId, { status: 'dismissed', completed })
}

export function replayProductTour() {
  window.dispatchEvent(new Event(PRODUCT_TOUR_EVENT))
}

export function signalProductTourProgress(task: ProductTourTask) {
  window.dispatchEvent(new CustomEvent<ProductTourTask>(PRODUCT_TOUR_PROGRESS_EVENT, { detail: task }))
}
