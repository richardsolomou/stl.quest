import { describe, expect, it } from 'vitest'
import { formatBytes } from './format'

describe('formatBytes', () => {
  it.each([
    [999, '999 B'],
    [1_000, '1.0 KB'],
    [1_500_000, '1.5 MB'],
    [2_000_000_000, '2.0 GB'],
    [3_000_000_000_000, '3.0 TB'],
  ])('formats %s bytes as %s', (bytes, expected) => expect(formatBytes(bytes)).toBe(expected))
})
