import { describe, expect, it } from 'vitest'
import type { Consumable, FilamentConsumable } from './consumables'
import { dailyUse, shoppingList, type RecentStockUse } from './shopping'
import type { Store } from './stores'
import type { StockLevel } from './usage'

const DAY = 86_400_000
const now = 100 * DAY
const pla: FilamentConsumable = { id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 20, storeId: 'bambu' }
const petg: FilamentConsumable = { id: 'petg', kind: 'filament', name: 'PETG', pricePerKg: 25, storeId: 'bambu' }
const ipa: Consumable = { id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 8 }
const bambu: Store = { id: 'bambu', name: 'Bambu Lab EU', shippingCost: 7, freeShippingOver: 55 }
const level = (consumableId: string, onHand: number, minimum?: number): StockLevel => ({
  consumableId,
  unit: consumableId === 'ipa' ? 'ml' : 'g',
  onHand,
  ...(minimum !== undefined && { minimum }),
  tracked: true,
  missing: onHand <= 0,
  low: onHand > 0 && minimum !== undefined && onHand < minimum,
})
const use = (overrides: Partial<RecentStockUse>): RecentStockUse => ({
  consumableId: 'pla',
  unit: 'g',
  used: 3_000,
  firstAt: 0,
  ...overrides,
})
const list = (levels: StockLevel[], options: { rates?: [string, number][]; stores?: Store[]; consumables?: Consumable[] } = {}) =>
  shoppingList({
    consumables: options.consumables ?? [pla, petg, ipa],
    levels,
    stores: options.stores ?? [bambu],
    rates: new Map(options.rates),
  })

describe('daily use', () => {
  it('averages what was used over the rate window', () => {
    expect(dailyUse(pla, [use({})], now)).toBe(100)
  })

  it('averages a log younger than the window over its own age', () => {
    expect(dailyUse(pla, [use({ used: 1_000, firstAt: now - 10 * DAY })], now)).toBe(100)
  })

  it('waits for a week of history', () => {
    expect(dailyUse(pla, [use({ firstAt: now - 6 * DAY })], now)).toBeUndefined()
  })

  it('has no rate when nothing was used lately', () => {
    expect(dailyUse(pla, [use({ used: 0 })], now)).toBeUndefined()
  })

  it('counts only the unit the consumable is stocked in', () => {
    expect(dailyUse(pla, [use({ unit: 'item' })], now)).toBeUndefined()
  })
})

describe('shopping list', () => {
  it('lists what is below its minimum', () => {
    expect(list([level('pla', 200, 500), level('petg', 900, 500)])[0].items.map(({ consumable }) => consumable.id)).toEqual(['pla'])
  })

  it('lists what runs out within two weeks at the recent rate, even above its minimum', () => {
    expect(list([level('pla', 1_300, 500)], { rates: [['pla', 100]] })[0].items[0].daysLeft).toBe(13)
  })

  it('leaves out what lasts beyond two weeks', () => {
    expect(list([level('pla', 1_500, 500)], { rates: [['pla', 100]] })).toEqual([])
  })

  it('leaves out what is untracked', () => {
    expect(list([{ ...level('pla', 0), tracked: false, missing: false }])).toEqual([])
  })

  it('leaves out what is archived', () => {
    expect(list([level('pla', 0)], { consumables: [{ ...pla, archived: true }] })).toEqual([])
  })

  it('puts what is gone first, then the fewest days left', () => {
    const groups = list([level('pla', 400, 500), level('petg', 0, 500)], { rates: [['pla', 100]] })
    expect(groups[0].items.map(({ consumable }) => consumable.id)).toEqual(['petg', 'pla'])
  })

  it('buys whole packs up to the minimum', () => {
    expect(list([level('pla', 200, 1_500)])[0].items[0].packs).toBe(2)
  })

  it('buys a month of use when that is more than the minimum', () => {
    expect(list([level('pla', 200, 500)], { rates: [['pla', 100]] })[0].items[0].packs).toBe(3)
  })

  it('prices what to buy at the consumable’s price', () => {
    expect(list([level('pla', 200, 1_500)])[0].subtotal).toBe(40)
  })

  it('buys a supply by volume by the litre', () => {
    expect(list([level('ipa', 0, 500)])[0].items[0]).toMatchObject({ pack: 1_000, cost: 8 })
  })

  it('groups by store, with what names no store last', () => {
    const groups = list([level('ipa', 0, 500), level('pla', 0, 500)])
    expect(groups.map(({ store }) => store?.id)).toEqual(['bambu', undefined])
  })

  it('treats an archived store as no store', () => {
    expect(list([level('pla', 0, 500)], { stores: [{ ...bambu, archived: true }] })[0].store).toBeUndefined()
  })

  it('says how far an order is from free shipping', () => {
    expect(list([level('pla', 0, 500)])[0].toFreeShipping).toBe(35)
  })

  it('adds shipping below the threshold', () => {
    expect(list([level('pla', 0, 500)])[0].shipping).toBe(7)
  })

  it('ships free once the order reaches the threshold', () => {
    const groups = list([level('pla', 0, 1_500), level('petg', 0, 500)])
    expect(groups[0]).toMatchObject({ subtotal: 65, shipping: 0 })
  })

  it('says nothing of free shipping once it is reached', () => {
    expect(list([level('pla', 0, 3_000)])[0].toFreeShipping).toBeUndefined()
  })

  it('knows no shipping for a store without a shipping cost', () => {
    expect(list([level('pla', 0, 500)], { stores: [{ id: 'bambu', name: 'Bambu' }] })[0].shipping).toBeUndefined()
  })
})
