import { describe, expect, it } from 'vitest'
import { highestStoragePlan, storagePlan } from './plans'

describe('storage plans', () => {
  it.each([
    [undefined, 'free'],
    ['unknown', 'free'],
    ['supporter', 'supporter'],
    ['pro', 'pro'],
  ])('maps %s to %s', (value, expected) => expect(storagePlan(value)).toBe(expected))

  it('selects the plan with the largest storage allowance', () => {
    expect(highestStoragePlan(['supporter', 'unknown', 'pro'])).toBe('pro')
  })

  it('defaults to free when there are no subscriptions', () => {
    expect(highestStoragePlan([])).toBe('free')
  })
})
