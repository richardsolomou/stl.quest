import { describe, expect, it } from 'vitest'
import { MAX_REQUEST_SOURCE_URL_LENGTH, normalizeRequestQuantity, validRequestQuantity, validSourceUrl } from './request'

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

describe('validSourceUrl', () => {
  it.each(['http://example.com/model', 'https://example.com/model'])('accepts %s', (value) => {
    expect(validSourceUrl(value)).toBe(true)
  })

  it.each(['ftp://example.com/model', 'not a URL', `https://example.com/${'x'.repeat(MAX_REQUEST_SOURCE_URL_LENGTH)}`])(
    'rejects %s',
    (value) => {
      expect(validSourceUrl(value)).toBe(false)
    },
  )
})
