import { describe, expect, it } from 'vitest'
import type { Consumable, FilamentConsumable } from './consumables'
import {
  externalIdStem,
  matchSpoolmanFilaments,
  spoolmanFilaments,
  spoolmanStock,
  type SpoolmanCatalogue,
  type SpoolmanLink,
  type SpoolmanSpool,
} from './spoolman'

const spool = (overrides: Partial<SpoolmanSpool> = {}): SpoolmanSpool => ({
  id: 1,
  filamentId: 10,
  filamentName: 'Black',
  vendor: 'Bambu Lab',
  material: 'PLA',
  colourHex: '#000000',
  externalId: 'bambulab_pla_black_1000_175_n',
  remainingGrams: 800,
  archived: false,
  updatedAt: 1,
  ...overrides,
})

const filament = (overrides: Partial<FilamentConsumable> = {}): FilamentConsumable => ({
  id: 'basic-black',
  kind: 'filament',
  name: 'Bambu Lab PLA Basic · Black',
  filamentPresetId: 'filament-bambu-lab-pla',
  colour: { name: 'Black', hex: '#000000' },
  pricePerKg: 20,
  ...overrides,
})

const catalogue: SpoolmanCatalogue = {
  colours: {
    bambulab_pla_black: ['filament-bambu-lab-pla', 'Black'],
    bambulab_pla_mattecharcoal: ['filament-bambu-lab-matte-pla', 'Charcoal'],
  },
  presets: {
    'filament-bambu-lab-pla': ['Bambu Lab', 'PLA'],
    'filament-bambu-lab-matte-pla': ['Bambu Lab', 'PLA'],
  },
}

describe('externalIdStem', () => {
  it('drops the weight, diameter, and spool type SpoolmanDB appends', () => {
    expect(externalIdStem('bambulab_pla_silkaurorapurple(blue-purple)_1000_175_n')).toBe('bambulab_pla_silkaurorapurple(blue-purple)')
  })

  it('keeps an id that has no such suffix', () => {
    expect(externalIdStem('my-own-id')).toBe('my-own-id')
  })
})

describe('spoolmanFilaments', () => {
  it('sums what is left on the spools still in use', () => {
    const [grouped] = spoolmanFilaments([spool(), spool({ id: 2, remainingGrams: 150 }), spool({ id: 3, archived: true })])
    expect(grouped.remainingGrams).toBe(950)
  })

  it('counts the spools still in use', () => {
    const [grouped] = spoolmanFilaments([spool(), spool({ id: 2 }), spool({ id: 3, archived: true })])
    expect(grouped.spools).toBe(2)
  })

  it('describes a filament by its most recently sent spool', () => {
    const [grouped] = spoolmanFilaments([spool({ updatedAt: 2, filamentName: 'Renamed' }), spool({ id: 2, updatedAt: 1 })])
    expect(grouped.name).toBe('Renamed')
  })
})

describe('matchSpoolmanFilaments', () => {
  const match = (spools: SpoolmanSpool[], consumables: Consumable[], links: SpoolmanLink[] = []) =>
    matchSpoolmanFilaments(spoolmanFilaments(spools), consumables, links, catalogue).get(10)

  it('matches a SpoolmanDB filament to the catalogue colour it came from', () => {
    expect(match([spool()], [filament(), filament({ id: 'other', colour: { name: 'Charcoal', hex: '#000000' } })])).toEqual({
      consumableId: 'basic-black',
      by: 'catalogue',
    })
  })

  it('tells product lines apart by the colour name in the SpoolmanDB id', () => {
    const matte = filament({ id: 'matte', filamentPresetId: 'filament-bambu-lab-matte-pla', colour: { name: 'Charcoal', hex: '#000000' } })
    expect(match([spool({ externalId: 'bambulab_pla_mattecharcoal_1000_175_n' })], [filament(), matte])?.consumableId).toBe('matte')
  })

  it('falls back to brand, material, and colour for a filament typed into Spoolman', () => {
    expect(match([spool({ externalId: undefined, colourHex: '#000000' })], [filament()])).toEqual({
      consumableId: 'basic-black',
      by: 'colour',
    })
  })

  it('leaves a fallback that fits two library filaments unmatched', () => {
    const matte = filament({ id: 'matte', filamentPresetId: 'filament-bambu-lab-matte-pla', colour: { name: 'Charcoal', hex: '#000000' } })
    expect(match([spool({ externalId: undefined })], [filament(), matte])).toBeUndefined()
  })

  it('ignores archived library filaments', () => {
    expect(match([spool()], [filament({ archived: true })])).toBeUndefined()
  })

  it('prefers a link someone chose', () => {
    const other = filament({ id: 'other', colour: { name: 'Charcoal', hex: '#111111' } })
    expect(match([spool()], [filament(), other], [{ filamentId: 10, consumableId: 'other' }])).toEqual({
      consumableId: 'other',
      by: 'manual',
    })
  })

  it('keeps a filament someone unlinked unmatched', () => {
    expect(match([spool()], [filament()], [{ filamentId: 10, consumableId: null }])).toBeUndefined()
  })
})

describe('spoolmanStock', () => {
  it('adds up every Spoolman filament linked to one library filament', () => {
    const filaments = spoolmanFilaments([spool(), spool({ id: 2, filamentId: 11, remainingGrams: 250 })])
    const matches = new Map([
      [10, { consumableId: 'basic-black', by: 'catalogue' as const }],
      [11, { consumableId: 'basic-black', by: 'manual' as const }],
    ])
    expect(spoolmanStock(filaments, matches).get('basic-black')).toEqual({ onHand: 1_050, spools: 2 })
  })
})
