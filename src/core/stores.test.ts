import { describe, expect, it } from 'vitest'
import type { Consumable, FilamentConsumable } from './consumables'
import {
  boughtWhereSold,
  inWorkspaceCurrency,
  landedConsumables,
  presetPage,
  shippingShare,
  storeCurrency,
  storeForProduct,
  type Store,
} from './stores'

const bambu: Store = { id: 'bambu', name: 'Bambu Lab EU', shippingCost: 7, freeShippingOver: 55, usualOrder: 35 }
const amazon: Store = { id: 'amazon', name: 'Amazon US', currency: 'USD', exchangeRate: 0.9, url: 'https://www.amazon.com/' }
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
