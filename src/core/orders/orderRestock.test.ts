import { describe, expect, it } from 'vitest'
import type { Consumable, FilamentConsumable } from '../consumables'
import type { FilamentPreset } from '../filamentPresets'
import type { Store } from '../stores'
import generated from '../../../catalogs/filaments/catalog.generated.json'
import { BAMBU_LAB_EU_FRENCH_TEXT, BAMBU_LAB_EU_GERMAN_TEXT, BAMBU_LAB_EU_HTML, BAMBU_LAB_EU_TEXT } from './fixtures'
import { parseOrderEmail, type OrderLine } from './orderEmail'
import { matchOrderLine, orderLineAmount, orderLinePrice, orderRestock, type OrderRestockChoice } from './orderRestock'

const preset = (id: string, name: string, colours: [string, string, string?][], brand = 'Bambu Lab'): FilamentPreset => ({
  id,
  brand,
  name,
  colors: colours.map(([en, hex, code]) => ({ hex, names: { en }, ...(code && { code }) })),
  source: { id: 'spoolmandb', url: 'https://example.com' },
})

const catalogue = [
  preset('filament-bambu-lab-pla', 'PLA Basic', [
    ['Gray', '#8E9089', '10103'],
    ['Jade White', '#FFFFFF', '10100'],
  ]),
  preset('filament-bambu-lab-matte-pla', 'Matte PLA', [['Charcoal', '#000000']]),
  preset('filament-bambu-lab-hf-petg', 'HF PETG', [['Black', '#000000']]),
  preset('filament-other-pla', 'PLA Basic', [['Gray', '#808080']], 'Other Brand'),
]

const filament = (overrides: Partial<FilamentConsumable> = {}): FilamentConsumable => ({
  id: 'basic-gray',
  kind: 'filament',
  name: 'Bambu Lab PLA Basic · Gray',
  filamentPresetId: 'filament-bambu-lab-pla',
  colour: { name: 'Gray', hex: '#8E9089' },
  pricePerKg: 20,
  ...overrides,
})

const line = (overrides: Partial<OrderLine> = {}): OrderLine => ({
  product: 'PLA Basic',
  colour: { name: 'Gray', code: '10103' },
  form: 'refill',
  grams: 1_000,
  quantity: 2,
  linePrice: 33.98,
  ...overrides,
})

const none = new Set<string>()

describe('matchOrderLine', () => {
  it('matches the library filament of the catalogue product and colour', () => {
    expect(matchOrderLine('bambu-lab', line(), [filament()], catalogue, none)).toEqual({ kind: 'library', consumableId: 'basic-gray' })
  })

  it('matches a product whose words come in another order', () => {
    const matte = filament({ id: 'matte', filamentPresetId: 'filament-bambu-lab-matte-pla', colour: { name: 'Charcoal', hex: '#000000' } })
    expect(matchOrderLine('bambu-lab', line({ product: 'PLA Matte', colour: { name: 'Charcoal' } }), [matte], catalogue, none)).toEqual({
      kind: 'library',
      consumableId: 'matte',
    })
  })

  it('matches grey and gray alike', () => {
    expect(matchOrderLine('bambu-lab', line({ colour: { name: 'Grey' } }), [filament()], catalogue, none).kind).toBe('library')
  })

  it('says Spoolman manages a matched filament it is linked to', () => {
    expect(matchOrderLine('bambu-lab', line(), [filament()], catalogue, new Set(['basic-gray']))).toEqual({
      kind: 'spoolman',
      consumableId: 'basic-gray',
    })
  })

  it('offers the catalogue colour when the library lacks it', () => {
    expect(matchOrderLine('bambu-lab', line({ colour: { name: 'Jade White' } }), [filament()], catalogue, none)).toEqual({
      kind: 'catalogue',
      presetId: 'filament-bambu-lab-pla',
      colour: { name: 'Jade White', hex: '#FFFFFF' },
    })
  })

  it('matches only the shop’s own brand in the catalogue', () => {
    const other = filament({ id: 'other', filamentPresetId: 'filament-other-pla', colour: { name: 'Gray', hex: '#808080' } })
    expect(matchOrderLine('bambu-lab', line(), [other], catalogue, none)).toEqual({
      kind: 'catalogue',
      presetId: 'filament-bambu-lab-pla',
      colour: { name: 'Gray', hex: '#8E9089' },
    })
  })

  it('matches a filament of the user’s own by every word of its title and colour', () => {
    const own = filament({ id: 'own', name: 'Bambu PLA Basic Gray', filamentPresetId: undefined, colour: undefined })
    expect(matchOrderLine('bambu-lab', line(), [own], [], none)).toEqual({ kind: 'library', consumableId: 'own' })
  })

  it('leaves a line that fits several of the user’s own filaments unmatched', () => {
    const own = (id: string) => filament({ id, name: `PLA Basic Gray ${id}`, filamentPresetId: undefined, colour: undefined })
    expect(matchOrderLine('bambu-lab', line(), [own('a'), own('b')], [], none)).toEqual({ kind: 'unmatched' })
  })

  it('skips archived filaments', () => {
    expect(matchOrderLine('bambu-lab', line(), [filament({ archived: true })], catalogue, none).kind).toBe('catalogue')
  })

  it('matches a colour by its code whatever name the email gives it', () => {
    expect(matchOrderLine('bambu-lab', line({ colour: { name: 'Grau', code: '10103' } }), [filament()], catalogue, none)).toEqual({
      kind: 'library',
      consumableId: 'basic-gray',
    })
  })

  it('offers the catalogue colour a code names in another language', () => {
    expect(matchOrderLine('bambu-lab', line({ colour: { name: 'Jade-Weiß', code: '10100' } }), [], catalogue, none)).toEqual({
      kind: 'catalogue',
      presetId: 'filament-bambu-lab-pla',
      colour: { name: 'Jade White', hex: '#FFFFFF' },
    })
  })

  it('matches by colour name when the catalogue lacks the code', () => {
    expect(matchOrderLine('bambu-lab', line({ colour: { name: 'Gray', code: '99999' } }), [filament()], catalogue, none).kind).toBe(
      'library',
    )
  })

  it('matches a code only among the shop’s own brand', () => {
    const other = [preset('filament-other-pla', 'PLA Basic', [['Grau', '#808080', '10103']], 'Other Brand')]
    expect(matchOrderLine('bambu-lab', line({ colour: { name: 'Grau', code: '10103' } }), [], other, none)).toEqual({ kind: 'unmatched' })
  })

  it('leaves an unknown product unmatched', () => {
    expect(matchOrderLine('bambu-lab', line({ product: 'PLA Mystery', colour: { name: 'Gray' } }), [filament()], catalogue, none)).toEqual({
      kind: 'unmatched',
    })
  })
})

describe('orderLineAmount', () => {
  it('multiplies the stated weight by the quantity', () => {
    expect(orderLineAmount(line(), filament())).toBe(2_000)
  })

  it('falls back to the pack size', () => {
    expect(orderLineAmount(line({ grams: undefined }), filament({ packSize: 500 }))).toBe(1_000)
  })
})

describe('orderLinePrice', () => {
  it('is the price per kilogram of filament', () => {
    expect(orderLinePrice(line(), filament())).toBe(16.99)
  })

  it('is unknown without a line price', () => {
    expect(orderLinePrice(line({ linePrice: undefined }), filament())).toBeUndefined()
  })
})

describe('orderRestock', () => {
  const consumables: Consumable[] = [filament()]
  const context = { consumables, stores: [], catalogue, currency: 'EUR' as const, updatePrices: false, newId: () => 'new-id' }
  const order = { vendor: 'bambu-lab' as const, currency: 'EUR' as const }

  it('restocks a library filament by what the line holds', () => {
    expect(orderRestock(order, [{ line: line(), consumableId: 'basic-gray' }], context).restocks).toEqual([
      { consumableId: 'basic-gray', amount: 2_000 },
    ])
  })

  it('adds lines for the same filament together', () => {
    const choices: OrderRestockChoice[] = [
      { line: line(), consumableId: 'basic-gray' },
      { line: line({ quantity: 1, linePrice: 19.99 }), consumableId: 'basic-gray' },
    ]
    expect(orderRestock(order, choices, context).restocks).toEqual([{ consumableId: 'basic-gray', amount: 3_000 }])
  })

  it('queues a spool in Spoolman for each spool a line of a filament Spoolman manages holds', () => {
    expect(orderRestock(order, [{ line: line(), spoolman: 'basic-gray' }], context).spoolman).toEqual([
      { consumableId: 'basic-gray', spools: 2, grams: 1_000 },
    ])
  })

  it('leaves the stock of a filament Spoolman manages alone', () => {
    expect(orderRestock(order, [{ line: line(), spoolman: 'basic-gray' }], context).restocks).toEqual([])
  })

  it('changes no price unless asked', () => {
    expect(orderRestock(order, [{ line: line(), consumableId: 'basic-gray' }], context).prices).toEqual([])
  })

  it('prices a filament from what its lines cost together when asked', () => {
    const choices: OrderRestockChoice[] = [
      { line: line(), consumableId: 'basic-gray' },
      { line: line({ quantity: 1, linePrice: 19.99 }), consumableId: 'basic-gray' },
    ]
    expect(orderRestock(order, choices, { ...context, updatePrices: true }).prices).toEqual([{ consumableId: 'basic-gray', price: 17.99 }])
  })

  it('takes no price from an order in another currency', () => {
    expect(
      orderRestock({ ...order, currency: 'GBP' }, [{ line: line(), consumableId: 'basic-gray' }], { ...context, updatePrices: true })
        .prices,
    ).toEqual([])
  })

  it('takes a price from an order in the currency of the filament’s store', () => {
    const stores: Store[] = [{ id: 'bambu-uk', name: 'Bambu Lab UK', currency: 'GBP', exchangeRate: 1.15 }]
    expect(
      orderRestock({ ...order, currency: 'GBP' }, [{ line: line(), consumableId: 'basic-gray' }], {
        ...context,
        consumables: [{ ...filament(), storeId: 'bambu-uk' }],
        stores,
        updatePrices: true,
      }).prices,
    ).toEqual([{ consumableId: 'basic-gray', price: 16.99 }])
  })

  it('takes no workspace-currency price for a filament whose store has its own', () => {
    const stores: Store[] = [{ id: 'bambu-uk', name: 'Bambu Lab UK', currency: 'GBP', exchangeRate: 1.15 }]
    expect(
      orderRestock(order, [{ line: line(), consumableId: 'basic-gray' }], {
        ...context,
        consumables: [{ ...filament(), storeId: 'bambu-uk' }],
        stores,
        updatePrices: true,
      }).prices,
    ).toEqual([])
  })

  it('adds a catalogue colour priced from the order', () => {
    const choice: OrderRestockChoice = {
      line: line(),
      add: { presetId: 'filament-bambu-lab-pla', colour: { name: 'Jade White', hex: '#FFFFFF' } },
    }
    expect(orderRestock(order, [choice], context).added).toEqual([
      {
        id: 'new-id',
        kind: 'filament',
        name: 'Bambu Lab PLA Basic · Jade White',
        filamentPresetId: 'filament-bambu-lab-pla',
        colour: { name: 'Jade White', hex: '#FFFFFF' },
        pricePerKg: 16.99,
      },
    ])
  })

  it('adds one filament for two lines of the same catalogue colour', () => {
    const add = { presetId: 'filament-bambu-lab-pla', colour: { name: 'Jade White', hex: '#FFFFFF' } }
    let next = 0
    const result = orderRestock(
      order,
      [
        { line: line(), add },
        { line: line({ form: 'spool' }), add },
      ],
      {
        ...context,
        newId: () => `new-${(next += 1)}`,
      },
    )
    expect(result.restocks).toEqual([{ consumableId: 'new-1', amount: 4_000 }])
  })

  it('leaves out a catalogue colour it cannot price', () => {
    const choice: OrderRestockChoice = {
      line: line(),
      add: { presetId: 'filament-bambu-lab-pla', colour: { name: 'Jade White', hex: '#FFFFFF' } },
    }
    expect(orderRestock({ ...order, currency: 'GBP' }, [choice], context)).toEqual({
      vendor: 'bambu-lab',
      added: [],
      prices: [],
      restocks: [],
    })
  })
})

describe('the filament catalogue', () => {
  it('names every Bambu Lab filament of the sample orders', () => {
    const presets = generated.presets as FilamentPreset[]
    const lines = [BAMBU_LAB_EU_TEXT, BAMBU_LAB_EU_HTML].flatMap((email) => parseOrderEmail(email)?.lines ?? [])
    expect(lines.map((orderLine) => matchOrderLine('bambu-lab', orderLine, [], presets, none))).toEqual([
      { kind: 'catalogue', presetId: 'filament-bambu-lab-pla', colour: { name: 'Gray', hex: '#8E9089' } },
      { kind: 'catalogue', presetId: 'filament-bambu-lab-matte-pla', colour: { name: 'Charcoal', hex: '#000000' } },
      { kind: 'catalogue', presetId: 'filament-bambu-lab-hf-petg', colour: { name: 'Black', hex: '#000000' } },
      { kind: 'catalogue', presetId: 'filament-bambu-lab-pla', colour: { name: 'Bambu Green', hex: '#00AE42' } },
      { kind: 'catalogue', presetId: 'filament-bambu-lab-silk-pla', colour: { name: 'Gold', hex: '#E5B03D' } },
    ])
  })

  it('names every Bambu Lab filament of the German and French sample orders by its code', () => {
    const presets = generated.presets as FilamentPreset[]
    const lines = [BAMBU_LAB_EU_GERMAN_TEXT, BAMBU_LAB_EU_FRENCH_TEXT].flatMap((email) => parseOrderEmail(email)?.lines ?? [])
    expect(lines.map((orderLine) => matchOrderLine('bambu-lab', orderLine, [], presets, none))).toEqual([
      { kind: 'catalogue', presetId: 'filament-bambu-lab-pla', colour: { name: 'Jade White', hex: '#FFFFFF' } },
      { kind: 'catalogue', presetId: 'filament-bambu-lab-pla', colour: { name: 'Gray', hex: '#8E9089' } },
      { kind: 'catalogue', presetId: 'filament-bambu-lab-pla', colour: { name: 'Jade White', hex: '#FFFFFF' } },
      { kind: 'catalogue', presetId: 'filament-bambu-lab-matte-pla', colour: { name: 'Charcoal', hex: '#000000' } },
      { kind: 'catalogue', presetId: 'filament-bambu-lab-hf-petg', colour: { name: 'Black', hex: '#000000' } },
    ])
  })
})
