import { describe, expect, it } from 'vitest'
import { getResinPreset, RESIN_PRESETS } from './resinPresets'

describe('resin presets', () => {
  it('keeps stable unique IDs and provenance', () => {
    expect(new Set(RESIN_PRESETS.map((preset) => preset.id)).size).toBe(RESIN_PRESETS.length)
    expect(RESIN_PRESETS.every((preset) => preset.source.url.startsWith('https://'))).toBe(true)
  })

  it('includes the PAP10 costing preset', () => {
    expect(getResinPreset('resin-heygears-pap10')).toMatchObject({
      brand: 'HeyGears',
      name: 'PAP10',
      densityGramsPerMl: 1.25,
    })
  })
})
