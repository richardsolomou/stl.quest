import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dismissProductTour, PRODUCT_TOUR_SNOOZE_MS, shouldShowProductTour, snoozeProductTour } from './productTour'

describe('product tour state', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      clear: () => values.clear(),
    })
  })

  it('shows the tour when the identity has no saved state', () => {
    expect(shouldShowProductTour('new-user', 1_000)).toBe(true)
  })

  it('keeps a dismissed tour hidden', () => {
    dismissProductTour('returning-user')
    expect(shouldShowProductTour('returning-user', 1_000)).toBe(false)
  })

  it('shows a snoozed tour again after one day', () => {
    vi.setSystemTime(1_000)
    snoozeProductTour('later-user', 1_000)
    expect(shouldShowProductTour('later-user', 1_000 + PRODUCT_TOUR_SNOOZE_MS)).toBe(true)
  })
})
