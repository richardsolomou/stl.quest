import { describe, expect, it } from 'vitest'
import type { Consumable, FilamentConsumable } from './consumables'
import {
  boughtWhereSold,
  consumableCurrency,
  inWorkspaceCurrency,
  landedConsumables,
  movedToStore,
  needsNewRate,
  presetPage,
  pricedStoreItems,
  shippingShare,
  storeCurrency,
  storeForProduct,
  type Store,
} from './stores'

const bambu: Store = { id: 'bambu', name: 'Bambu Lab EU', shippingCost: 7, freeShippingOver: 55, usualOrder: 35 }
const amazon: Store = {
  id: 'amazon',
  name: 'Amazon US',
  currency: 'USD',
  exchangeRate: 0.9,
  exchangeRateCurrency: 'EUR',
  url: 'https://www.amazon.com/',
}
const uk: Store = { id: 'uk', name: 'UK', currency: 'GBP', exchangeRate: 1.2, exchangeRateCurrency: 'EUR' }
const pla: FilamentConsumable = { id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 20, storeId: 'bambu' }
const price = (consumables: Consumable[], stores: Store[]) => {
  const [landed] = landedConsumables(consumables, stores, 'EUR')
  return landed.kind === 'filament' ? landed.pricePerKg : undefined
}

describe('shipping share', () => {
  it('spreads shipping over the usual order', () => {
    expect(shippingShare(bambu)).toBe(0.2)
  })

  it('spreads nothing when the usual order ships free', () => {
    expect(shippingShare({ ...bambu, usualOrder: 60 })).toBe(0)
  })

  it('spreads nothing without a usual order', () => {
    expect(shippingShare({ ...bambu, usualOrder: undefined })).toBe(0)
  })
})

describe('landed consumables', () => {
  it('adds the store’s shipping share to the price', () => {
    expect(price([pla], [bambu])).toBe(24)
  })

  it('converts a price in the store’s currency to the workspace’s', () => {
    expect(price([{ ...pla, storeId: 'amazon' }], [amazon])).toBe(18)
  })

  it('ignores the rate of a store in the workspace currency', () => {
    expect(price([{ ...pla, storeId: 'amazon' }], [{ ...amazon, currency: 'EUR' }])).toBe(20)
  })

  it('keeps the price of what names no store', () => {
    expect(price([{ ...pla, storeId: undefined }], [bambu])).toBe(20)
  })

  it('still prices what names an archived store at it', () => {
    expect(price([pla], [{ ...bambu, archived: true }])).toBe(24)
  })
})

describe('store currency', () => {
  it('is the store’s own when it has one', () => {
    expect(storeCurrency(amazon, 'EUR')).toBe('USD')
  })

  it('is the workspace’s otherwise', () => {
    expect(storeCurrency(bambu, 'EUR')).toBe('EUR')
  })

  it('converts an amount at the store’s rate', () => {
    expect(inWorkspaceCurrency(100, amazon, 'EUR')).toBe(90)
  })

  it('is what a consumable is priced in through its store', () => {
    expect(consumableCurrency({ ...pla, storeId: 'amazon' }, [amazon], 'EUR')).toBe('USD')
  })
})

describe('exchange rate', () => {
  it('needs a new rate once the workspace currency is another', () => {
    expect(needsNewRate(amazon, 'GBP')).toBe(true)
  })

  it('needs no rate when the store’s currency became the workspace’s', () => {
    expect(needsNewRate(amazon, 'USD')).toBe(false)
  })

  it('needs a new rate when it never said what it converts into', () => {
    expect(needsNewRate({ ...amazon, exchangeRateCurrency: undefined }, 'EUR')).toBe(true)
  })

  it('converts nothing at a rate into another currency', () => {
    expect(inWorkspaceCurrency(100, amazon, 'GBP')).toBe(100)
  })

  it('leaves landed prices unconverted at a rate into another currency', () => {
    expect(price([{ ...pla, storeId: 'amazon' }], [{ ...amazon, exchangeRateCurrency: 'GBP' }])).toBe(20)
  })
})

describe('moving to another store', () => {
  const moved = (from: string | undefined, to: Store | undefined, stores: Store[], workspace: 'EUR' | 'GBP' = 'EUR') => {
    const item = movedToStore({ ...pla, storeId: from }, to, stores, workspace)
    return item.kind === 'filament' ? [item.pricePerKg, item.storeId] : undefined
  }

  it('converts the price into the new store’s currency', () => {
    expect(moved(undefined, amazon, [amazon])).toEqual([22.22, 'amazon'])
  })

  it('converts the price into the workspace currency when it leaves for no store', () => {
    expect(moved('amazon', undefined, [amazon])).toEqual([18, undefined])
  })

  it('converts between two stores’ currencies through the workspace’s', () => {
    expect(moved('uk', amazon, [uk, amazon])).toEqual([26.67, 'amazon'])
  })

  it('keeps the price between stores in the same currency', () => {
    expect(moved('bambu', undefined, [bambu])).toEqual([20, undefined])
  })

  it('keeps the price when a rate is into another currency', () => {
    expect(moved('amazon', undefined, [amazon], 'GBP')).toEqual([20, undefined])
  })

  it('keeps small prices to four significant figures', () => {
    const gloves: Consumable = { id: 'gloves', kind: 'supply', name: 'Gloves', unit: 'item', price: 0.1 }
    const item = movedToStore(gloves, amazon, [amazon], 'EUR')
    expect(item.kind === 'supply' && item.price).toBe(0.1111)
  })
})

describe('store items repriced', () => {
  const library: Consumable[] = [
    { ...pla, storeId: 'amazon', pricePerKg: 30 },
    { ...pla, id: 'other', storeId: undefined, pricePerKg: 30 },
  ]
  const prices = (items: Consumable[]) => items.map((item) => (item.kind === 'filament' ? item.pricePerKg : undefined))

  it('converts the store’s prices into its new currency', () => {
    expect(prices(pricedStoreItems(library, amazon, { ...amazon, currency: 'GBP', exchangeRate: 1.2 }, 'EUR'))).toEqual([22.5, 30])
  })

  it('converts the store’s prices into the workspace currency when it no longer has its own', () => {
    const own = { ...amazon, currency: undefined, exchangeRate: undefined, exchangeRateCurrency: undefined }
    expect(prices(pricedStoreItems(library, amazon, own, 'EUR'))).toEqual([27, 30])
  })

  it('keeps the store’s prices when only its rate moves', () => {
    expect(prices(pricedStoreItems(library, amazon, { ...amazon, exchangeRate: 0.95 }, 'EUR'))).toEqual([30, 30])
  })

  it('takes the shipping share out of the store’s prices', () => {
    expect(prices(pricedStoreItems(library, amazon, amazon, 'EUR', { from: 0, to: 0.2 }))).toEqual([25, 30])
  })

  it('puts back shipping taken out before', () => {
    expect(prices(pricedStoreItems(library, amazon, amazon, 'EUR', { from: 0.2, to: 0.5 }))).toEqual([24, 30])
  })
})

describe('store for a product', () => {
  const stores = [{ ...bambu, url: 'https://eu.store.bambulab.com/' }, amazon]

  it('finds the store whose website hosts the product', () => {
    expect(storeForProduct(stores, 'https://eu.store.bambulab.com/products/pla-basic')?.id).toBe('bambu')
  })

  it('ignores www', () => {
    expect(storeForProduct(stores, 'https://amazon.com/dp/B0')?.id).toBe('amazon')
  })

  it('matches a page on a subdomain of the store', () => {
    expect(storeForProduct(stores, 'https://smile.amazon.com/dp/B0')?.id).toBe('amazon')
  })

  it('does not match a host that only ends the same', () => {
    expect(storeForProduct(stores, 'https://notamazon.com/dp/B0')).toBeUndefined()
  })

  it('skips archived stores', () => {
    expect(storeForProduct([{ ...amazon, archived: true }], 'https://www.amazon.com/dp/B0')).toBeUndefined()
  })

  it('finds nothing for an address that is not a URL', () => {
    expect(storeForProduct(stores, 'not a url')).toBeUndefined()
  })
})

describe('preset page', () => {
  it('is where the list price was read', () => {
    expect(presetPage({ listPrice: { url: 'https://shop.test/a' }, source: { url: 'https://github.com/a' } })).toBe('https://shop.test/a')
  })

  it('falls back to the catalogue source', () => {
    expect(presetPage({ source: { url: 'https://formlabs.com/store/grey' } })).toBe('https://formlabs.com/store/grey')
  })
})

describe('bought where sold', () => {
  const stores = [{ ...bambu, url: 'https://eu.store.bambulab.com/' }]

  it('buys a catalogue product from the store selling it', () => {
    expect(boughtWhereSold(pla, stores, { listPrice: { url: 'https://eu.store.bambulab.com/products/a' } }).storeId).toBe('bambu')
  })

  it('leaves the store unset when no store sells it', () => {
    expect(boughtWhereSold({ ...pla, storeId: undefined }, stores, { source: { url: 'https://github.com/a' } }).storeId).toBeUndefined()
  })
})
