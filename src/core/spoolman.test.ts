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
    'filament-acme-pla': ['Acme', 'PLA', 'PLA'],
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

    it('needs the product in a name when the brand and material have several products', () => {
      expect(match([typed('Charcoal')], [basic, matte])).toBeUndefined()
    })

    it('matches a name that gives only the colour when the brand and material have one product', () => {
      const acme = (id: string, colour: string) =>
        filament({ id, filamentPresetId: 'filament-acme-pla', colour: { name: colour, hex: '#000000' } })
      expect(match([typed('Jet', { vendor: 'Acme' })], [acme('black', 'Black'), acme('jet', 'Jet')])?.consumableId).toBe('jet')
    })

    it('needs the product in a name without a colour hex, even when the brand and material have one product', () => {
      const acme = filament({ id: 'acme', filamentPresetId: 'filament-acme-pla' })
      expect(match([typed('Black', { vendor: 'Acme', colourHex: undefined })], [acme])).toBeUndefined()
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

  describe('with the generated catalogue, for a filament typed without a colour hex', () => {
    const library = (...entries: [id: string, colour: string][]) =>
      entries.map(([id, colour]) => filament({ id, name: id, filamentPresetId: id, colour: { name: colour, hex: '#123456' } }))
    const typed = (consumables: Consumable[], vendor: string, material: string, filamentName: string) =>
      matchSpoolmanFilaments(
        spoolmanFilaments([spool({ externalId: undefined, colourHex: undefined, vendor, material, filamentName })]),
        consumables,
        [],
        SPOOLMAN_CATALOGUE,
      ).get(10)

    it('leaves a bare colour unmatched when the brand and material have several products', () => {
      expect(
        typed(library(['filament-bambu-lab-tough-pla', 'Black'], ['filament-bambu-lab-pla', 'Jade White']), 'Bambu Lab', 'PLA', 'Black'),
      ).toBeUndefined()
    })

    it('leaves a colour match alone when the name names another catalogue filament', () => {
      const found = matchSpoolmanFilaments(
        spoolmanFilaments([
          spool({ externalId: undefined, colourHex: '#000000', vendor: 'Bambu Lab', material: 'PLA', filamentName: 'Matte Charcoal' }),
        ]),
        [
          filament({
            id: 'basic-black',
            name: 'basic-black',
            filamentPresetId: 'filament-bambu-lab-pla',
            colour: { name: 'Black', hex: '#000000' },
          }),
        ],
        [],
        SPOOLMAN_CATALOGUE,
      )
      expect(found.get(10)).toBeUndefined()
    })

    it('never reads PLA+ as PLA', () => {
      expect(typed(library(['filament-esun-basic-pla', 'Black']), 'eSUN', 'PLA+', 'PLA+ Black')).toBeUndefined()
    })

    it('reads a partial brand in a colour name as part of the colour', () => {
      expect(typed(library(['filament-bambu-lab-silk-pla', 'Green']), 'Bambu Lab', 'PLA', 'Bambu Green')).toBeUndefined()
    })

    it('reads a brand-named colour as a colour, not a brand and a colour', () => {
      expect(typed(library(['filament-polymaker-panchroma-silk-pla', 'Teal']), 'Polymaker', 'PLA', 'Polymaker Teal')).toBeUndefined()
    })

    it('reads Inland Blue as a colour, not a brand and a colour', () => {
      expect(typed(library(['filament-inland-tough-pla', 'Blue']), 'Inland', 'PLA', 'Inland Blue')).toBeUndefined()
    })

    it('keeps the order of the colour words', () => {
      expect(
        typed(library(['filament-novtau-thermochromic-pla', 'Green to Yellow']), 'NOVTAU', 'PLA', 'Thermochromic PLA Yellow to Green'),
      ).toBeUndefined()
    })

    it('leaves a product word folded into a colour unmatched', () => {
      expect(typed(library(['filament-novtau-wood-pla', 'Tone']), 'NOVTAU', 'PLA', 'Wood Tone')).toBeUndefined()
    })

    it('needs every colour word, not only the last', () => {
      expect(typed(library(['filament-overture-easy-pla', 'White']), 'Overture', 'PLA', 'Easy PLA Rock White')).toBeUndefined()
    })

    it('tells Red Raspberry from Raspberry Red', () => {
      expect(typed(library(['filament-inland-tough-pla', 'Raspberry Red']), 'Inland', 'PLA', 'Tough PLA Red Raspberry')).toBeUndefined()
    })

    it('matches a name that gives the product and colour in order', () => {
      expect(
        typed(
          library(['filament-novtau-thermochromic-pla', 'Green to Yellow'], ['filament-novtau-wood-pla', 'Tone']),
          'NOVTAU',
          'PLA',
          'NOVTAU Thermochromic PLA Green to Yellow',
        )?.consumableId,
      ).toBe('filament-novtau-thermochromic-pla')
    })
  })

  it('never reads a PLA+ filament as PLA by colour', () => {
    const esun = filament({ filamentPresetId: 'filament-esun-basic-pla' })
    const found = matchSpoolmanFilaments(
      spoolmanFilaments([spool({ externalId: undefined, vendor: 'eSUN', material: 'PLA+' })]),
      [esun],
      [],
      SPOOLMAN_CATALOGUE,
    )
    expect(found.get(10)).toBeUndefined()
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
