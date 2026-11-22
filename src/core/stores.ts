import { consumablePrice, withConsumablePrice, type Consumable } from './consumables'
import type { PriceCalculatorCurrency } from './priceCalculator'

export const MAX_STORES = 50

/**
 * Where consumables are bought, and what it charges to ship an order: `shippingCost` per order, waived once an order
 * reaches `freeShippingOver`. Both are what the user sets, since they vary by country. Its amounts, and the prices of
 * what is bought there, are in its own `currency`, or the workspace's when it has none.
 */
export type Store = {
  id: string
  name: string
  shippingCost?: number
  freeShippingOver?: number
  currency?: PriceCalculatorCurrency
  /** What one unit of `currency` costs in the workspace currency, as the user enters it; nothing fetches rates. */
  exchangeRate?: number
  /** What an order usually comes to, so its shipping can be spread over the prices of what is bought there. */
  usualOrder?: number
  /** Its website, which matches the catalogue's product pages to it. */
  url?: string
  /** Kept so consumables that name it still resolve, but left out of pickers and the shopping list. */
  archived?: boolean
}

export function storeCurrency(store: Store | undefined, workspace: PriceCalculatorCurrency) {
  return store?.currency ?? workspace
}

/** An amount in a store's currency, in the workspace's at the store's rate. */
export function inWorkspaceCurrency(amount: number, store: Store | undefined, workspace: PriceCalculatorCurrency) {
  return storeCurrency(store, workspace) === workspace ? amount : amount * (store?.exchangeRate ?? 1)
}

/**
 * What shipping adds to each price at a store, as a share: its shipping cost over its usual order, or nothing once
 * that order ships free. Without a usual order shipping is not counted, as prices entered before it included it.
 */
export function shippingShare(store: Store) {
  const { shippingCost, usualOrder, freeShippingOver } = store
  if (!shippingCost || !usualOrder || (freeShippingOver !== undefined && usualOrder >= freeShippingOver)) return 0
  return shippingCost / usualOrder
}

/** The library priced as costs count it: each price in the workspace currency, with its store's shipping share added. */
export function landedConsumables(consumables: Consumable[], stores: Store[], workspace: PriceCalculatorCurrency) {
  return consumables.map((consumable) => {
    const store = consumable.storeId === undefined ? undefined : stores.find(({ id }) => id === consumable.storeId)
    if (!store) return consumable
    const factor = inWorkspaceCurrency(1 + shippingShare(store), store, workspace)
    return factor === 1 ? consumable : withConsumablePrice(consumable, consumablePrice(consumable) * factor)
  })
}

/** Where a catalogue product is sold: the page its list price was read from, else its catalogue source. */
export function presetPage(preset?: { listPrice?: { url: string }; source?: { url: string } }) {
  return preset?.listPrice?.url ?? preset?.source?.url
}

/** A new catalogue consumable, bought from the store in use whose website sells its product, if any. */
export function boughtWhereSold<Item extends Consumable>(item: Item, stores: Store[], preset: Parameters<typeof presetPage>[0]): Item {
  const store = storeForProduct(stores, presetPage(preset))
  return store ? { ...item, storeId: store.id } : item
}

/** The store in use whose website hosts a product page: the same host or one under it, ignoring `www.`. */
export function storeForProduct(stores: Store[], url: string | undefined) {
  const host = url === undefined ? undefined : hostOf(url)
  if (!host) return undefined
  return stores.find((store) => {
    const own = !store.archived && store.url ? hostOf(store.url) : undefined
    return own !== undefined && (host === own || host.endsWith(`.${own}`))
  })
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}
