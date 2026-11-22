import { describe, expect, it } from 'vitest'
import catalog from '../../catalogs/parts/catalog.json'
import {
  genericPartPresets,
  partPresetChoices,
  partPresetsForGroup,
  partPresetsForPrinter,
  partPresetUnitPrice,
  type PartPreset,
} from './partPresets'
import { findPreset } from './presets'

const PART_PRESETS = catalog.presets as PartPreset[]
const getPartPreset = (id?: string) => findPreset(PART_PRESETS, id)

describe('part presets', () => {
  it('keeps unique IDs', () => {
    expect(new Set(PART_PRESETS.map((preset) => preset.id)).size).toBe(PART_PRESETS.length)
  })

  it('finds a preset by ID', () => {
    expect(getPartPreset('part-formlabs-form-4-resin-tank')).toMatchObject({ lifespan: 190, lifespanUnit: 'plates' })
  })

  it('finds no preset without an ID', () => {
    expect(getPartPreset()).toBeUndefined()
  })

  it('lists the parts made for a printer model', () => {
    expect(partPresetsForPrinter(PART_PRESETS, 'resin-formlabs-form-4').map((preset) => preset.id)).toEqual([
      'part-formlabs-form-4-resin-tank',
      'part-formlabs-form-4-flex-build-platform',
    ])
  })

  it('leaves generic parts out of a printer model', () => {
    expect(partPresetsForPrinter(PART_PRESETS, 'resin-formlabs-form-4').some((preset) => !preset.fits.length)).toBe(false)
  })

  it('lists no parts for an unknown printer model', () => {
    expect(partPresetsForPrinter(PART_PRESETS, 'resin-unknown')).toEqual([])
  })

  it('lists only parts that fit no particular model as generic', () => {
    expect(genericPartPresets(PART_PRESETS, 'resin').every((preset) => preset.fits.length === 0 && preset.printType === 'resin')).toBe(true)
  })

  it('splits a pack price across its parts', () => {
    expect(partPresetUnitPrice(getPartPreset('part-elegoo-fep-film-mars-4-5')!)).toBe(5)
  })

  it('has no unit price without a list price', () => {
    const preset = getPartPreset('part-elegoo-fep-film-mars-4-5')!
    expect(partPresetUnitPrice({ ...preset, listPrice: undefined })).toBeUndefined()
  })
})

describe('part presets for a group', () => {
  it('offers a model its own parts', () => {
    expect(
      partPresetsForGroup(PART_PRESETS, { printType: 'resin', printerPresetId: 'resin-formlabs-form-4' }).map(({ id }) => id),
    ).toContain('part-formlabs-form-4-resin-tank')
  })

  it('offers a custom printer the generic parts of its type', () => {
    expect(partPresetsForGroup(PART_PRESETS, { printType: 'resin' })).toEqual(genericPartPresets(PART_PRESETS, 'resin'))
  })
})

describe('part preset choices', () => {
  const nozzle: PartPreset = {
    ...getPartPreset('part-bambu-lab-hotend-a1-0-4-stainless')!,
    id: 'part-generic-nozzle',
    fits: [],
  }
  const parts = [...PART_PRESETS, nozzle]
  const fleet = [
    { printType: 'filament' as const, printerPresetId: 'filament-bambu-lab-a1' },
    { printType: 'resin' as const, printerPresetId: 'resin-formlabs-form-4' },
  ]

  it('offers a model only its own parts', () => {
    expect(partPresetChoices(parts, { printType: 'filament', printerPresetId: 'filament-bambu-lab-a1' }, fleet)).toEqual([
      { printerPresetId: 'filament-bambu-lab-a1', presets: partPresetsForPrinter(parts, 'filament-bambu-lab-a1') },
    ])
  })

  it('offers a print type its generic parts, then each fleet model of that type', () => {
    expect(partPresetChoices(parts, { printType: 'filament' }, fleet).map(({ printerPresetId }) => printerPresetId)).toEqual([
      undefined,
      'filament-bambu-lab-a1',
    ])
  })

  it('offers a print type its fleet models’ parts when no part is generic', () => {
    expect(partPresetChoices(PART_PRESETS, { printType: 'resin' }, fleet).map(({ printerPresetId }) => printerPresetId)).toEqual([
      'resin-formlabs-form-4',
    ])
  })

  it('offers a custom printer only generic parts', () => {
    expect(partPresetChoices(parts, { printType: 'filament', printerId: 'printer-1' }, fleet)).toEqual([{ presets: [nozzle] }])
  })
})
