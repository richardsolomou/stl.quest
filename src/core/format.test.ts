import { describe, expect, it } from 'vitest'
import { formatBytes } from './format'

describe('formatBytes', () => {
  it.each([
    [999, '999 B'],
    [1_000, '1.0 KB'],
    [1_500_000, '1.5 MB'],
    [2_000_000_000, '2.0 GB'],
    [3_000_000_000_000, '3.0 TB'],
    // Rounding must not leave the value in the smaller unit.
    [999_995_300, '1.0 GB'],
    [999_999, '1.0 MB'],
  ])('formats %s bytes as %s', (bytes, expected) => expect(formatBytes(bytes)).toBe(expected))

  it('uses French units and decimal comma', () => {
    expect(formatBytes(1_500_000_000, 'fr')).toBe('1,5 Go')
  })

  it('uses a German decimal comma', () => {
    expect(formatBytes(1_500_000, 'de')).toBe('1,5 MB')
  })

  it('does not group thousands of the largest unit', () => {
    expect(formatBytes(3_000_000_000_000_000)).toBe('3000.0 TB')
  })
})
