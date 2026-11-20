import { describe, expect, it } from 'vitest'
import { findPreset } from './presets'

const presets = [{ id: 'a' }, { id: 'b' }]

describe('finding a preset', () => {
  it('finds the entry with the ID', () => {
    expect(findPreset(presets, 'b')).toBe(presets[1])
  })

  it('finds nothing without an ID', () => {
    expect(findPreset(presets)).toBeUndefined()
  })

  it('finds nothing while the catalogue loads', () => {
    expect(findPreset(undefined, 'a')).toBeUndefined()
  })
})
