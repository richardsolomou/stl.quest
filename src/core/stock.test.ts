import { describe, expect, it } from 'vitest'
import type { Consumable, PartConsumable } from './consumables'
import catalog from '../../catalogs/parts/catalog.json'
import type { PartPreset } from './partPresets'
import { findPreset } from './presets'
import { missingMaterials, missingWearParts, packSize, partCategory, partFromPreset, untrackedConsumables } from './stock'
import type { StockLevel } from './usage'
import type { PrinterProfile } from './types'

const parts = catalog.presets as PartPreset[]

const form4: PrinterProfile = { id: 'form-4-a', name: 'Form 4 · A', printType: 'resin', presetId: 'resin-formlabs-form-4' }
const mk4: PrinterProfile = { id: 'mk4', name: 'MK4', printType: 'filament', presetId: 'filament-prusa-mk4' }
const x2d: PrinterProfile = { id: 'x2d', name: 'X2D', printType: 'filament', presetId: 'filament-bambu-lab-x2d' }
const resin: Consumable = { id: 'resin', kind: 'resin', name: 'Grey', pricePerLitre: 150, densityGramsPerMl: 1.1 }
const part = (overrides: Partial<PartConsumable>): PartConsumable => ({
  id: 'part',
  kind: 'part',
  name: 'Part',
  printType: 'resin',
  price: 0,
  lifespan: 100,
  lifespanUnit: 'plates',
  ...overrides,
})
const suggested = (consumables: Consumable[], fleet: PrinterProfile[]) =>
  missingWearParts(consumables, fleet, parts).map(({ preset }) => preset.id)

describe('pack size', () => {
  it('restocks resin by the litre bottle', () => {
    expect(packSize(resin)).toBe(1_000)
  })

  it('keeps a pack size of the consumable’s own', () => {
    expect(packSize({ ...resin, packSize: 5_000 })).toBe(5_000)
  })

  it('has no default for a supply measured by volume', () => {
    expect(packSize({ id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 10 })).toBeUndefined()
  })
})

describe('missing wear parts', () => {
  it('suggests a fleet model’s catalogue parts', () => {
    expect(suggested([], [form4])).toContain('part-formlabs-form-4-resin-tank')
  })

  it('suggests a generic part for each print type the fleet prints', () => {
    const generic: PartPreset = {
      id: 'part-generic-resin-film',
      brand: 'Generic',
      name: 'Release film',
      category: 'release-film',
      printType: 'resin',
      fits: [],
      lifespan: 50,
      lifespanUnit: 'plates',
      lifespanSource: { basis: 'typical', note: 'A typical estimate.' },
      source: { id: 'test', url: 'https://example.com' },
    }
    expect(missingWearParts([], [form4], [generic]).map(({ preset }) => preset.id)).toEqual([generic.id])
  })

  it('suggests nothing for archived printers', () => {
    expect(suggested([], [{ ...form4, archived: true }])).toEqual([])
  })

  it('treats a catalogue part added to the model as had', () => {
    const tank = part({ partPresetId: 'part-formlabs-form-4-resin-tank', printerPresetId: 'resin-formlabs-form-4' })
    expect(suggested([tank], [form4])).not.toContain('part-formlabs-form-4-resin-tank')
  })

  it('treats a part named like the kind as had', () => {
    expect(suggested([part({ name: 'Spare vat', printerPresetId: 'resin-formlabs-form-4' })], [form4])).not.toContain(
      'part-formlabs-form-4-resin-tank',
    )
  })

  it('still suggests a model’s part when the library has it for another model', () => {
    expect(suggested([part({ name: 'Tank', printerPresetId: 'resin-formlabs-form-3' })], [form4])).toContain(
      'part-formlabs-form-4-resin-tank',
    )
  })

  it('drops the alternatives once one of them is had', () => {
    const sheet = part({ printType: 'filament', partPresetId: 'part-prusa-satin-sheet', printerPresetId: 'filament-prusa-mk4' })
    expect(suggested([sheet], [mk4])).not.toContain('part-prusa-smooth-pei-sheet')
  })

  it('still suggests a model’s air filter once it has a hotend', () => {
    const hotend = part({ printType: 'filament', name: 'Spare hotend', printerPresetId: 'filament-bambu-lab-x2d' })
    expect(suggested([hotend], [x2d])).toContain('part-bambu-lab-air-filter-x2d')
  })

  it('counts the printers a part would serve', () => {
    const tank = missingWearParts([], [form4, { ...form4, id: 'form-4-b' }], parts).find(
      ({ preset }) => preset.id === 'part-formlabs-form-4-resin-tank',
    )
    expect(tank?.printers).toBe(2)
  })
})

describe('missing materials', () => {
  it('flags a print type the fleet prints without any material', () => {
    expect(missingMaterials([resin], [form4, mk4])).toEqual([{ printType: 'filament', printers: 1 }])
  })
})

describe('part from the catalogue', () => {
  const preset = findPreset(parts, 'part-elegoo-pfa-film-saturn')!

  it('leaves the price for the user to enter', () => {
    expect(partFromPreset('film', { preset }).price).toBe(0)
  })

  it('keeps the catalogue’s lifespan', () => {
    expect(partFromPreset('film', { preset })).toMatchObject({ lifespan: preset.lifespan, lifespanUnit: preset.lifespanUnit })
  })

  it('restocks by the catalogue’s pack', () => {
    expect(partFromPreset('film', { preset }).packSize).toBe(5)
  })

  it('belongs to the model it was suggested for', () => {
    expect(partFromPreset('film', { preset, printerPresetId: 'resin-elegoo-saturn-4' }).printerPresetId).toBe('resin-elegoo-saturn-4')
  })

  it('belongs to the custom printer it was added to', () => {
    expect(partFromPreset('film', { preset, printerId: 'printer-1' }).printerId).toBe('printer-1')
  })

  it('remembers its catalogue part', () => {
    expect(partCategory(partFromPreset('film', { preset }), parts)).toBe('release-film')
  })
})

describe('part category', () => {
  it('reads a German name', () => {
    expect(partCategory(part({ name: 'Ersatzdüse 0,4' }), parts)).toBe('nozzle')
  })

  it('reads an air filter in a compound word', () => {
    expect(partCategory(part({ name: 'Aktivkohlefilter X2D' }), parts)).toBe('air-filter')
  })
})

describe('untracked consumables', () => {
  const pla: Consumable = { id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 20 }
  const grey: Consumable = { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 40, densityGramsPerMl: 1.1 }
  const level = (consumableId: string, tracked: boolean): StockLevel => ({
    consumableId,
    unit: 'g',
    onHand: 0,
    tracked,
    low: false,
    missing: false,
  })

  it('counts active consumables with no tracked stock', () => {
    expect(untrackedConsumables([pla, grey], [level('pla', true), level('grey', false)])).toBe(1)
  })

  it('leaves archived consumables out', () => {
    expect(untrackedConsumables([{ ...pla, archived: true }], [])).toBe(0)
  })
})
