import { describe, expect, it } from 'vitest'
import { highestStoragePlan, nextStoragePlan, storagePlan, storageUsageLevel } from './plans'

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

describe('storageUsageLevel', () => {
  it.each([
    [0, 'ok'],
    [790, 'ok'],
    [800, 'nearing'],
    [999, 'nearing'],
    [1000, 'full'],
    [1200, 'full'],
  ])('reports %i bytes of 1000 as %s', (used, expected) => expect(storageUsageLevel(used, 1000)).toBe(expected))

  it('treats a missing allowance as full', () => {
    expect(storageUsageLevel(0, 0)).toBe('full')
  })
})

describe('nextStoragePlan', () => {
  it.each([
    ['free', 'supporter'],
    ['supporter', 'pro'],
  ])('offers %s the %s plan', (plan, expected) => expect(nextStoragePlan(plan as never)).toBe(expected))

  it('offers nothing beyond the largest plan', () => {
    expect(nextStoragePlan('pro')).toBeUndefined()
  })
})
