import { describe, expect, it } from 'vitest'
import type { Consumable } from './consumables'
import type { EquipmentItem } from './equipment'
import type { PrinterProfile } from './types'
import { consumed, stepUsageDrafts, stockLevels, stockOnHand, usagePrefills, type UsageEvent } from './usage'

const resin: Consumable = { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 40, densityGramsPerMl: 1.1 }
const ipa: Consumable = { id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 10, minimumStock: 500 }
const rates = { electricityPricePerKwh: 0.3 }
const printer: Pick<PrinterProfile, 'id' | 'printType'> = { id: 'printer', printType: 'resin' }
const cure: EquipmentItem = {
  id: 'cure',
  name: 'Cure station',
  kind: 'cure',
  stage: 'finishing',
  powerWatts: 40,
  minutesPerUse: 15,
  supplies: [{ consumableId: 'removed', amountPerUse: 5 }],
}

describe('stepUsageDrafts', () => {
  it('skips the material when the estimate does not know it', () => {
    const drafts = stepUsageDrafts(
      { requestId: 'print', stage: 'printing', copies: 1, consumableId: resin.id },
      { rates, estimate: { minutes: 30 }, material: resin, equipment: [], consumables: [resin] },
    )

    expect(drafts).toEqual([])
  })

  it('skips supplies whose consumable left the library', () => {
    const drafts = stepUsageDrafts(
      { requestId: 'print', stage: 'finishing', copies: 2, equipmentIds: [cure.id] },
      { rates, equipment: [cure], consumables: [resin] },
    )

    expect(drafts.map(({ equipmentId, consumableId }) => ({ equipmentId, consumableId }))).toEqual([
      { equipmentId: cure.id, consumableId: undefined },
    ])
  })

  it('records the printer without minutes when the estimate lacks them', () => {
    const drafts = stepUsageDrafts(
      { requestId: 'print', stage: 'printing', copies: 2, printerId: printer.id },
      { rates, printer, estimate: {}, equipment: [], consumables: [] },
    )

    expect(drafts.map(({ printerId, amount, unit }) => ({ printerId, amount, unit }))).toEqual([
      { printerId: 'printer', amount: 0, unit: 'minute' },
    ])
  })

  it('carries the outcome onto every event', () => {
    const drafts = stepUsageDrafts(
      { requestId: 'print', stage: 'printing', copies: 1, printerId: printer.id, consumableId: resin.id, outcome: 'failed' },
      { rates, printer, estimate: { material: 5, minutes: 30 }, material: resin, equipment: [], consumables: [resin] },
    )

    expect(drafts.map((draft) => draft.outcome)).toEqual(['failed', 'failed'])
  })
})

describe('stepUsageDrafts wear', () => {
  const vat: Consumable = { id: 'vat', kind: 'part', name: 'Vat', printType: 'resin', price: 50, lifespan: 100, lifespanUnit: 'plates' }
  const drafts = stepUsageDrafts(
    { requestId: 'print', stage: 'printing', copies: 3, printerId: printer.id },
    {
      rates,
      printer,
      estimate: { minutes: 30 },
      equipment: [],
      consumables: [
        { ...vat, printerId: printer.id },
        { ...vat, id: 'other-vat', printerId: 'other' },
      ],
    },
  )

  it('records the wear of a custom printer’s own part', () => {
    expect(drafts.find((draft) => draft.consumableId === vat.id)).toMatchObject({ unit: 'plate', amount: 3, unitPrice: 0.5 })
  })

  it('records no wear of another printer’s own part', () => {
    expect(drafts.some((draft) => draft.consumableId === 'other-vat')).toBe(false)
  })
})

describe('consumed', () => {
  it('records no price for an unpriced item', () => {
    expect(consumed({ ...ipa, price: 0 })).toEqual({ consumableId: ipa.id, unit: 'ml' })
  })

  it('prices a supply bought by the litre per millilitre', () => {
    expect(consumed(ipa).unitPrice).toBe(0.01)
  })
})

describe('stockLevels', () => {
  it('ignores events in a unit the consumable is no longer stocked in', () => {
    const [level] = stockLevels(
      [{ ...ipa, minimumStock: undefined }],
      [
        { consumableId: ipa.id, kind: 'restock', unit: 'item', amount: 3 },
        { consumableId: ipa.id, kind: 'restock', unit: 'ml', amount: 1_000 },
      ],
    )

    expect(level.onHand).toBe(1_000)
  })

  it('flags tracked stock at zero as missing rather than low', () => {
    const [level] = stockLevels(
      [ipa],
      [
        { consumableId: ipa.id, kind: 'restock', unit: 'ml', amount: 20 },
        { consumableId: ipa.id, kind: 'use', unit: 'ml', amount: 20 },
      ],
    )

    expect(level).toMatchObject({ missing: true, low: false })
  })

  it('does not start tracking from usage alone', () => {
    const [level] = stockLevels([{ ...ipa, minimumStock: undefined }], [{ consumableId: ipa.id, kind: 'use', unit: 'ml', amount: 20 }])

    expect(level).toMatchObject({ tracked: false, missing: false })
  })

  it('never flags a consumable nobody tracks', () => {
    const [level] = stockLevels([resin], [])

    expect(level).toMatchObject({ tracked: false, missing: false, low: false })
  })
})

describe('stockOnHand', () => {
  const event = (overrides: Partial<UsageEvent>): UsageEvent => ({
    id: 'event',
    transactionId: 'transaction',
    stage: 'stock',
    kind: 'restock',
    consumableId: ipa.id,
    amount: 1_000,
    unit: 'ml',
    createdAt: 1,
    ...overrides,
  })

  it('adds restocks and signed corrections, subtracts use, waste, and replacements, and skips undone events and other units', () => {
    expect(
      stockOnHand(
        [
          event({}),
          event({ kind: 'correction', amount: -100 }),
          event({ kind: 'use', amount: 50 }),
          event({ kind: 'waste', amount: 25 }),
          event({ kind: 'replace', amount: 5 }),
          event({ kind: 'restock', amount: 500, undoneAt: 2 }),
          event({ kind: 'use', amount: 3, unit: 'item' }),
        ],
        ipa,
      ),
    ).toBe(820)
  })
})

describe('usagePrefills', () => {
  const wash: EquipmentItem = { ...cure, id: 'wash', kind: 'wash', printType: 'resin', supplies: [] }
  const event = (overrides: Partial<UsageEvent>): UsageEvent => ({
    id: 'event',
    transactionId: 'transaction',
    stage: 'printing',
    kind: 'use',
    amount: 1,
    unit: 'minute',
    createdAt: 1,
    ...overrides,
  })

  it('takes the newest printer per print type', () => {
    const prefills = usagePrefills(
      [event({ printerId: 'old', createdAt: 1 }), event({ printerId: 'new', createdAt: 2 })],
      [
        { id: 'old', printType: 'resin' },
        { id: 'new', printType: 'resin' },
      ],
      [],
    )

    expect(prefills.printers).toEqual({ resin: 'new' })
  })

  it('skips archived printers', () => {
    const prefills = usagePrefills([event({ printerId: 'gone' })], [{ id: 'gone', printType: 'resin', archived: true }], [])

    expect(prefills.printers).toEqual({})
  })

  it('takes the newest material per printer, not its wear parts', () => {
    const prefills = usagePrefills(
      [
        event({ printerId: printer.id, consumableId: resin.id, unit: 'ml', createdAt: 1 }),
        event({ printerId: printer.id, consumableId: 'tank', unit: 'plate', createdAt: 2 }),
      ],
      [printer],
      [],
    )

    expect(prefills.materials).toEqual({ [printer.id]: resin.id })
  })

  it('finishes a print type with the set its print was last finished with', () => {
    const prefills = usagePrefills(
      [
        event({ requestId: 'print', printerId: printer.id }),
        event({ transactionId: 'finish', stage: 'finishing', requestId: 'print', equipmentId: cure.id, createdAt: 2 }),
        event({
          transactionId: 'finish',
          stage: 'finishing',
          requestId: 'print',
          equipmentId: cure.id,
          consumableId: ipa.id,
          unit: 'ml',
          createdAt: 2,
        }),
      ],
      [printer],
      [cure],
    )

    expect(prefills.finishing).toEqual({ resin: [cure.id] })
  })

  it('falls back to the print type the equipment serves', () => {
    const prefills = usagePrefills([event({ stage: 'finishing', requestId: 'unknown', equipmentId: wash.id })], [], [wash])

    expect(prefills.finishing).toEqual({ resin: [wash.id] })
  })
})
