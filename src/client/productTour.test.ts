import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dismissProductTour, PRODUCT_TOUR_SNOOZE_MS, productTourState, saveProductTourState, snoozeProductTour } from './productTour'

describe('product tour state', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      clear: () => values.clear(),
    })
  })

  it('starts a new identity with an empty active checklist', () => {
    expect(productTourState('new-user', 1_000)).toEqual({ status: 'active', completed: [] })
  })

  it('keeps completed tasks when the guide is dismissed', () => {
    dismissProductTour('returning-user', ['upload'])
    expect(productTourState('returning-user', 1_000)).toEqual({ status: 'dismissed', completed: ['upload'] })
  })

  it('reactivates a snoozed checklist after one day', () => {
    snoozeProductTour('later-user', ['upload'], 1_000)
    expect(productTourState('later-user', 1_000 + PRODUCT_TOUR_SNOOZE_MS)).toEqual({
      status: 'active',
      completed: ['upload'],
      until: 1_000 + PRODUCT_TOUR_SNOOZE_MS,
    })
  })

  it('saves progress between visits', () => {
    saveProductTourState('learning-user', { status: 'active', completed: ['upload', 'move'] })
    expect(productTourState('learning-user', 1_000).completed).toEqual(['upload', 'move'])
  })
})
