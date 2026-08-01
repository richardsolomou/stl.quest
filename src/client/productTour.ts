export const PRODUCT_TOUR_EVENT = 'stlquest:product-tour'
export const PRODUCT_TOUR_SNOOZE_MS = 24 * 60 * 60 * 1000

type ProductTourState = { status: 'snoozed'; until: number } | { status: 'dismissed' }

function key(identityId: string) {
  return `stlquest:product-tour:v1:${identityId}`
}

export function shouldShowProductTour(identityId: string, now = Date.now()) {
  const saved = localStorage.getItem(key(identityId))
  if (!saved) return true
  try {
    const state = JSON.parse(saved) as ProductTourState
    return state.status === 'snoozed' && state.until <= now
  } catch {
    return true
  }
}

export function snoozeProductTour(identityId: string, now = Date.now()) {
  localStorage.setItem(key(identityId), JSON.stringify({ status: 'snoozed', until: now + PRODUCT_TOUR_SNOOZE_MS }))
}

export function dismissProductTour(identityId: string) {
  localStorage.setItem(key(identityId), JSON.stringify({ status: 'dismissed' }))
}

export function replayProductTour() {
  window.dispatchEvent(new Event(PRODUCT_TOUR_EVENT))
}
