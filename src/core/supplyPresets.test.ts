import { describe, expect, it } from 'vitest'
import catalog from '../../catalogs/supplies/catalog.json'
import { findPreset } from './presets'
import { supplyFromPreset, supplyPresetsFor, supplyPresetsForEquipment, supplyPresetUnitPrice, type SupplyPreset } from './supplyPresets'

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
    expect(supplyPresetsForEquipment(SUPPLY_PRESETS, ['postprocess-formlabs-form-studio-wash-cure']).map(({ id }) => id)).toEqual([
      'supply-formlabs-resin-washing-solution',
      'supply-isopropyl-alcohol',
      'supply-tpm',
    ])
  })

  it('names nothing for equipment without a catalogue model', () => {
    expect(supplyPresetsForEquipment(SUPPLY_PRESETS, [undefined])).toEqual([])
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
