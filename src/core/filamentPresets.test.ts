import { describe, expect, it } from 'vitest'
import type { Consumable, FilamentConsumable } from './consumables'
import {
  filamentProductGroups,
  filamentsInColours,
  sameFilamentProduct,
  stockedColours,
  withSharedFilamentPrice,
  type FilamentPreset,
} from './filamentPresets'

const preset: FilamentPreset = {
  id: 'bambu-pla',
  brand: 'Bambu Lab',
  name: 'PLA Basic',
  colors: [
    { hex: '#000000', names: { en: 'Black' } },
    { hex: '#FFFFFF', names: { en: 'White' } },
  ],
  source: { id: 'bambu', url: 'https://example.com' },
}
const black = { name: 'Black', hex: '#000000' }
const white = { name: 'White', hex: '#FFFFFF' }

function filament(id: string, fields: Partial<FilamentConsumable> = {}): FilamentConsumable {
  return { id, kind: 'filament', name: id, pricePerKg: 20, ...fields }
}

describe('filamentsInColours', () => {
  const draft = { ...filament('draft'), filamentPresetId: preset.id, name: 'Bambu Lab PLA Basic', pricePerKg: 24, packSize: 1_000 }
  let next = 0
  const added = filamentsInColours(draft, preset, [black, white], () => `new-${(next += 1)}`)

  it('gives every colour a new ID, so the draft is never stored as one of them', () => {
    expect(added.map(({ id }) => id)).toEqual(['new-1', 'new-2'])
  })

  it('names each colour after the product', () => {
    expect(added.map(({ name }) => name)).toEqual(['Bambu Lab PLA Basic · Black', 'Bambu Lab PLA Basic · White'])
  })

  it('shares the draft’s price and pack size', () => {
    expect(added.map(({ pricePerKg, packSize }) => [pricePerKg, packSize])).toEqual([
      [24, 1_000],
      [24, 1_000],
    ])
  })
})

describe('sameFilamentProduct', () => {
  const library: Consumable[] = [
    filament('black', { filamentPresetId: preset.id, colour: black }),
    filament('white', { filamentPresetId: preset.id, colour: white }),
    filament('old', { filamentPresetId: preset.id, archived: true }),
    filament('other', { filamentPresetId: 'other' }),
    filament('own'),
  ]

  it('finds the other active colours of a catalogue product', () => {
    expect(sameFilamentProduct(library, library[0] as FilamentConsumable).map(({ id }) => id)).toEqual(['white'])
  })

  it('finds none for a filament of the user’s own', () => {
    expect(sameFilamentProduct([...library, filament('own-2')], filament('own'))).toEqual([])
  })
})

describe('stockedColours', () => {
  it('lists the colours of a product the library has in use', () => {
    const library: Consumable[] = [
      filament('black', { filamentPresetId: preset.id, colour: black }),
      filament('white', { filamentPresetId: preset.id, colour: white, archived: true }),
      filament('other', { filamentPresetId: 'other', colour: white }),
    ]
    expect(stockedColours(library, preset.id)).toEqual([black])
  })
})

describe('filamentProductGroups', () => {
  it('gathers the colours of one product where its first one sits', () => {
    const items = [filament('black', { filamentPresetId: preset.id }), filament('own'), filament('white', { filamentPresetId: preset.id })]
    expect(filamentProductGroups(items).map((group) => group.filaments.map(({ id }) => id))).toEqual([['black', 'white'], ['own']])
  })

  it('names the product of a group', () => {
    const items = [filament('black', { filamentPresetId: preset.id }), filament('white', { filamentPresetId: preset.id })]
    expect(filamentProductGroups(items)[0].presetId).toBe(preset.id)
  })

  it('keeps a product with one colour as a plain filament', () => {
    expect(filamentProductGroups([filament('black', { filamentPresetId: preset.id })])[0].presetId).toBeUndefined()
  })
})

describe('withSharedFilamentPrice', () => {
  const library: Consumable[] = [
    filament('black', { filamentPresetId: preset.id, pricePerKg: 26 }),
    filament('white', { filamentPresetId: preset.id, pricePerKg: 20 }),
    filament('old', { filamentPresetId: preset.id, pricePerKg: 20, archived: true }),
    filament('other', { filamentPresetId: 'other', pricePerKg: 20 }),
  ]
  const shared = withSharedFilamentPrice(library, 'black')

  it('gives the other active colours of the product its price', () => {
    expect(shared.map((item) => (item.kind === 'filament' ? item.pricePerKg : undefined))).toEqual([26, 26, 20, 20])
  })

  it('leaves an unknown filament’s library as it is', () => {
    expect(withSharedFilamentPrice(library, 'missing')).toBe(library)
  })
})
