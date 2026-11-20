import { describe, expect, it } from 'vitest'
import type { Consumable } from './consumables'
import {
  equipmentForStage,
  equipmentPrintType,
  kindPrintType,
  kindServesAny,
  missingSupplies,
  supplyUnit,
  supplyUnitPrice,
  type EquipmentItem,
} from './equipment'

const ipa: Consumable = { id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 8 }
const wash: EquipmentItem = {
  id: 'wash',
  name: 'Form Wash',
  kind: 'wash',
  stage: 'finishing',
  printType: 'resin',
  powerWatts: 50,
  minutesPerUse: 10,
  supplies: [{ consumableId: 'ipa', amountPerUse: 1 }],
}
const dryer: EquipmentItem = { ...wash, id: 'dryer', kind: 'dryer', stage: 'before-printing', printType: 'filament', supplies: [] }

describe('equipment', () => {
  it('offers finishing equipment for the print type at that step', () => {
    expect(equipmentForStage([wash, dryer], 'finishing', 'resin').map(({ id }) => id)).toEqual(['wash'])
  })

  it('leaves archived equipment out of a step', () => {
    expect(equipmentForStage([{ ...wash, archived: true }], 'finishing', 'resin')).toEqual([])
  })

  it('offers equipment that serves both print types to either', () => {
    expect(equipmentForStage([{ ...wash, kind: 'ultrasonic', printType: undefined }], 'finishing', 'filament')).toHaveLength(1)
  })

  it('keeps a wash station to resin whatever it stored', () => {
    expect(equipmentForStage([{ ...wash, printType: undefined }], 'finishing', 'filament')).toEqual([])
  })

  it('serves resin with washing and curing kinds', () => {
    expect(kindPrintType('wash-cure')).toBe('resin')
  })

  it('serves filament with a dryer', () => {
    expect(kindPrintType('dryer')).toBe('filament')
  })

  it('leaves an oven to serve either', () => {
    expect(kindPrintType('oven')).toBeUndefined()
  })

  it('prefers the kind over a stored print type', () => {
    expect(equipmentPrintType({ kind: 'cure', printType: 'filament' })).toBe('resin')
  })

  it('reads a stored print type for a kind that serves either', () => {
    expect(equipmentPrintType({ kind: 'ultrasonic', printType: 'filament' })).toBe('filament')
  })

  it('measures a supply in its own unit', () => {
    expect(supplyUnit(ipa)).toBe('ml')
  })

  it('measures a resin used as a supply by volume', () => {
    expect(supplyUnit({ id: 'r', kind: 'resin', name: 'Grey', pricePerLitre: 50, densityGramsPerMl: 1.1 })).toBe('ml')
  })

  it('measures a wear part costed per plate in plates', () => {
    expect(
      supplyUnit({ id: 'p', kind: 'part', name: 'Basket', printType: 'resin', price: 20, lifespan: 500, lifespanUnit: 'plates' }),
    ).toBe('plate')
  })

  it('measures a wear part costed per hour in minutes', () => {
    expect(supplyUnit({ id: 'p', kind: 'part', name: 'Lamp', printType: 'resin', price: 20, lifespan: 500, lifespanUnit: 'hours' })).toBe(
      'minute',
    )
  })

  it('finds supplies whose consumable has left the library', () => {
    expect(missingSupplies({ ...wash, supplies: [...wash.supplies, { consumableId: 'gone', amountPerUse: 2 }] }, [ipa])).toEqual([
      { consumableId: 'gone', amountPerUse: 2 },
    ])
  })

  it('prices a liquid supply per millilitre', () => {
    expect(supplyUnitPrice({ id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 10 })).toBe(0.01)
  })

  it('prices a plate-rated part used as a supply per plate', () => {
    expect(
      supplyUnitPrice({ id: 'p', kind: 'part', name: 'Basket', printType: 'resin', price: 20, lifespan: 500, lifespanUnit: 'plates' }),
    ).toBe(0.04)
  })

  it('prices an hour-rated part used as a supply per minute', () => {
    expect(
      supplyUnitPrice({ id: 'p', kind: 'part', name: 'Lamp', printType: 'resin', price: 30, lifespan: 500, lifespanUnit: 'hours' }),
    ).toBeCloseTo(0.001)
  })

  it('offers no wash station to a filament-only workspace', () => {
    expect(kindServesAny('wash', ['filament'])).toBe(false)
  })

  it('offers an oven to any workspace', () => {
    expect(kindServesAny('oven', ['filament'])).toBe(true)
  })
})
