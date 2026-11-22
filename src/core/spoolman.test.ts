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
import { SPOOLMAN_CATALOGUE } from './spoolmanCatalogue'

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
    'filament-bambu-lab-pla': ['Bambu Lab', 'PLA', 'PLA Basic'],
    'filament-bambu-lab-matte-pla': ['Bambu Lab', 'PLA', 'Matte PLA'],
    'filament-bambu-lab-silk-pla': ['Bambu Lab', 'PLA', 'Silk+ PLA'],
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

  it('leaves a fallback that fits two library filaments and has no name unmatched', () => {
    const matte = filament({ id: 'matte', filamentPresetId: 'filament-bambu-lab-matte-pla', colour: { name: 'Charcoal', hex: '#000000' } })
    expect(match([spool({ externalId: undefined, filamentName: undefined })], [filament(), matte])).toBeUndefined()
  })

  describe('by name, for a filament typed into Spoolman', () => {
    const basic = filament({ name: 'Bambu Lab PLA Basic · Black' })
    const matte = filament({
      id: 'matte',
      name: 'Bambu Lab Matte PLA · Charcoal',
      filamentPresetId: 'filament-bambu-lab-matte-pla',
      colour: { name: 'Charcoal', hex: '#000000' },
    })
    const typed = (filamentName: string, overrides: Partial<SpoolmanSpool> = {}) =>
      spool({ externalId: undefined, filamentName, ...overrides })

    it('tells two products of one colour apart by the product in the name', () => {
      expect(match([typed('PLA Basic Black')], [basic, matte])).toEqual({ consumableId: 'basic-black', by: 'name' })
    })

    it('matches a name without the brand or material words', () => {
      expect(match([typed('Matte Charcoal')], [basic, matte])?.consumableId).toBe('matte')
    })

    it('matches a name with the material words in another order', () => {
      expect(match([typed('PLA Matte Charcoal')], [basic, matte])?.consumableId).toBe('matte')
    })

    it('matches a name that includes the brand, ignoring case and punctuation', () => {
      expect(match([typed('bambu-lab matte pla, CHARCOAL')], [basic, matte])?.consumableId).toBe('matte')
    })

    it('matches a name that gives only the colour when one candidate has it', () => {
      expect(match([typed('Charcoal')], [basic, matte])?.consumableId).toBe('matte')
    })

    it('leaves a name that fits two candidates unmatched', () => {
      const silk = filament({ id: 'silk', filamentPresetId: 'filament-bambu-lab-silk-pla', colour: { name: 'Black', hex: '#000000' } })
      expect(match([typed('Black')], [basic, silk])).toBeUndefined()
    })

    it('leaves a name that names no candidate unmatched', () => {
      expect(match([typed('Galaxy Black')], [basic, matte])).toBeUndefined()
    })

    it('needs the name to give the colour, not only the product', () => {
      expect(match([typed('Matte PLA')], [basic, matte])).toBeUndefined()
    })

    it('matches by name when Spoolman has no colour hex', () => {
      expect(match([typed('Matte Charcoal', { colourHex: undefined })], [basic, matte])).toEqual({ consumableId: 'matte', by: 'name' })
    })

    it('needs the brand to agree when matching by name', () => {
      expect(match([typed('Matte Charcoal', { colourHex: undefined, vendor: 'Polymaker' })], [basic, matte])).toBeUndefined()
    })

    it('tells PLA Basic Black from Matte Charcoal with the generated catalogue', () => {
      const found = matchSpoolmanFilaments(spoolmanFilaments([typed('PLA Basic Black')]), [basic, matte], [], SPOOLMAN_CATALOGUE)
      expect(found.get(10)).toEqual({ consumableId: 'basic-black', by: 'name' })
    })

    it('keeps matching by colour when only one candidate has it', () => {
      expect(match([typed('Something Else')], [basic])).toEqual({ consumableId: 'basic-black', by: 'colour' })
    })
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
