import { describe, expect, it } from 'vitest'
import { normalizeRequestQuantity, validRequestQuantity } from './requestQuantity'

describe('normalizeRequestQuantity', () => {
  it.each([
    ['missing values', undefined, 1, undefined],
    ['decimal values', '2.6', 3, undefined],
    ['values below the minimum', -4, 1, undefined],
    ['values above the maximum', 80, 50, undefined],
    ['custom fallbacks', '', 7, 7],
  ])('%s', (_name, value, expected, fallback) => {
    expect(normalizeRequestQuantity(value, fallback)).toBe(expected)
  })
})

describe('validRequestQuantity', () => {
  it.each([1, 25, 50])('accepts %s', (value) => {
    expect(validRequestQuantity(value)).toBe(true)
  })

  it.each([0, 51, 1.5, '2'])('rejects %s', (value) => {
    expect(validRequestQuantity(value)).toBe(false)
  })
})
