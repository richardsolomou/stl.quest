import { describe, expect, it } from 'vitest'
import catalog from '../../catalogs/supplies/catalog.json'
import { findPreset } from './presets'
import {
  supplyFromPreset,
  supplyPresetsFor,
  supplyPresetsUsedBy,
  supplyPresetUnitPrice,
  supplyUserIds,
  type SupplyPreset,
} from './supplyPresets'

const SUPPLY_PRESETS = catalog.presets as SupplyPreset[]
const preset = (id: string) => findPreset(SUPPLY_PRESETS, id)!
const washingSolution = preset('supply-formlabs-resin-washing-solution')
const glue = preset('supply-bambu-lab-glue-stick')
const ipa = preset('supply-isopropyl-alcohol')

describe('supply presets', () => {
  it('keeps unique IDs', () => {
    expect(new Set(SUPPLY_PRESETS.map(({ id }) => id)).size).toBe(SUPPLY_PRESETS.length)
  })

  it('leaves resin-only supplies out of a filament workspace', () => {
    expect(supplyPresetsFor(SUPPLY_PRESETS, ['filament'])).not.toContainEqual(washingSolution)
  })

  it('offers supplies both print types use to a filament workspace', () => {
    expect(supplyPresetsFor(SUPPLY_PRESETS, ['filament'])).toContainEqual(ipa)
  })

  it('names the wash fluids Formlabs lists for the Form Studio Wash+Cure', () => {
    expect(supplyPresetsUsedBy(SUPPLY_PRESETS, ['postprocess-formlabs-form-studio-wash-cure']).map(({ id }) => id)).toEqual([
      'supply-formlabs-resin-washing-solution',
      'supply-isopropyl-alcohol',
      'supply-tpm',
    ])
  })

  it('names nothing for equipment without a catalogue model', () => {
    expect(supplyPresetsUsedBy(SUPPLY_PRESETS, [undefined])).toEqual([])
  })

  it('names desiccant for a printer with an AMS 2 Pro, which dries filament without any dryer', () => {
    const x2d = {
      id: 'x2d',
      name: 'X2D',
      printType: 'filament' as const,
      presetId: 'filament-bambu-lab-x2d',
      addOnPresetIds: ['accessory-bambu-lab-ams-2-pro'],
    }
    expect(supplyPresetsUsedBy(SUPPLY_PRESETS, supplyUserIds([], [x2d])).map(({ id }) => id)).toEqual(
      expect.arrayContaining(['supply-bambu-lab-molecular-sieve-desiccant', 'supply-bambu-lab-silicone-desiccant']),
    )
  })

  it('names lubricant for a Bambu Lab printer', () => {
    const p1s = { id: 'p1s', name: 'P1S', printType: 'filament' as const, presetId: 'filament-bambu-lab-p1s' }
    expect(supplyPresetsUsedBy(SUPPLY_PRESETS, supplyUserIds([], [p1s])).map(({ id }) => id)).toContain('supply-bambu-lab-lubricant-grease')
  })

  it('leaves out archived printers and equipment', () => {
    const p1s = { id: 'p1s', name: 'P1S', printType: 'filament' as const, presetId: 'filament-bambu-lab-p1s', archived: true }
    expect(supplyUserIds([], [p1s])).toEqual([])
  })

  it('adds a catalogue supply under its brand, unit, and pack', () => {
    expect(supplyFromPreset('rws', washingSolution)).toEqual({
      id: 'rws',
      kind: 'supply',
      name: 'Formlabs Resin Washing Solution',
      unit: 'ml',
      price: 0,
      supplyPresetId: 'supply-formlabs-resin-washing-solution',
      packSize: 5_000,
    })
  })

  it('names a generic supply without a brand', () => {
    expect(supplyFromPreset('ipa', ipa).name).toBe('Isopropyl alcohol (IPA)')
  })

  it('prices a liquid by the litre', () => {
    expect(supplyPresetUnitPrice(washingSolution)).toBe(17.85)
  })

  it('prices a single item as listed', () => {
    expect(supplyPresetUnitPrice(glue)).toBe(4.99)
  })

  it('has no unit price without a list price', () => {
    expect(supplyPresetUnitPrice(ipa)).toBeUndefined()
  })
})
