import { describe, expect, it } from 'vitest'
import { ageUnit, isAgeHot } from './requestAge'

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

describe('ageUnit', () => {
  it('counts minutes under an hour', () => {
    expect(ageUnit(42 * minute)).toEqual({ value: 42, unit: 'minute' })
  })

  it('never reports less than one minute', () => {
    expect(ageUnit(5_000)).toEqual({ value: 1, unit: 'minute' })
  })

  it('counts hours under a day', () => {
    expect(ageUnit(5 * hour + 59 * minute)).toEqual({ value: 5, unit: 'hour' })
  })

  it('counts days under two weeks', () => {
    expect(ageUnit(13 * day)).toEqual({ value: 13, unit: 'day' })
  })

  it('counts weeks from two weeks', () => {
    expect(ageUnit(15 * day)).toEqual({ value: 2, unit: 'week' })
  })

  it('treats a clock behind the request as just now', () => {
    expect(ageUnit(-hour)).toEqual({ value: 1, unit: 'minute' })
  })
})

describe('isAgeHot', () => {
  it('is cool under a week', () => {
    expect(isAgeHot(7 * day - 1)).toBe(false)
  })

  it('is hot from a week', () => {
    expect(isAgeHot(7 * day)).toBe(true)
  })
})
