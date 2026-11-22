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
  /** What one unit of `currency` costs in `exchangeRateCurrency`, as the user enters it; nothing fetches rates. */
  exchangeRate?: number
  /** The workspace currency when the rate was entered; once the workspace uses another, the store needs a new rate. */
  exchangeRateCurrency?: PriceCalculatorCurrency
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

/** What a consumable is priced in: its store's currency, or the workspace's when it has no store. */
export function consumableCurrency(consumable: Consumable, stores: Store[], workspace: PriceCalculatorCurrency) {
  return storeCurrency(storeOf(consumable, stores), workspace)
}

/**
 * What one unit of a store's currency costs in the workspace's: 1 when they are the same, else its rate while that rate
 * is into the workspace currency, and unknown once the workspace uses another.
 */
function storeRate(store: Store | undefined, workspace: PriceCalculatorCurrency) {
  if (storeCurrency(store, workspace) === workspace) return 1
  return store?.exchangeRateCurrency === workspace ? store.exchangeRate : undefined
}

/** Whether a store's rate is into a currency the workspace no longer uses, so nothing converts its prices until it has a new one. */
export function needsNewRate(store: Store, workspace: PriceCalculatorCurrency) {
  return storeRate(store, workspace) === undefined
}

/** An amount in a store's currency, in the workspace's at the store's rate; unconverted while the store needs a new rate. */
export function inWorkspaceCurrency(amount: number, store: Store | undefined, workspace: PriceCalculatorCurrency) {
  return amount * (storeRate(store, workspace) ?? 1)
}

/**
 * A price in one store's currency (the workspace's for no store) at the same value in another's, converted through the
 * workspace currency. It stays as it is between the same currency, or when either rate is unknown.
 */
function convertedPrice(price: number, from: Store | undefined, to: Store | undefined, workspace: PriceCalculatorCurrency) {
  if (storeCurrency(from, workspace) === storeCurrency(to, workspace)) return price
  const fromRate = storeRate(from, workspace)
  const toRate = storeRate(to, workspace)
  return fromRate === undefined || toRate === undefined ? price : roundedPrice((price * fromRate) / toRate)
}

/** Cents, or four significant figures for a price under one, so a converted price reads like an entered one. */
function roundedPrice(price: number) {
  if (!Number.isFinite(price) || price === 0) return price
  const decimals = Math.max(2, 3 - Math.floor(Math.log10(Math.abs(price))))
  return Number(price.toFixed(decimals))
}

/** A consumable bought from `to` (or no store) instead of where it is now, with its price kept at the same value. */
export function movedToStore<Item extends Consumable>(
  item: Item,
  to: Store | undefined,
  stores: Store[],
  workspace: PriceCalculatorCurrency,
): Item {
  const price = convertedPrice(consumablePrice(item), storeOf(item, stores), to, workspace)
  return { ...withConsumablePrice(item, price), storeId: to?.id }
}

/** The share of shipping taken out of a store's prices before a save (`from`) and after it (`to`). */
export type ShippingTakenOut = { from: number; to: number }

/**
 * The library once a store changes from `before` to `after`: what is bought there keeps its prices' value in the
 * store's new currency, and, with `shippingTakenOut`, its prices lose the shipping share they were entered with.
 */
export function pricedStoreItems(
  consumables: Consumable[],
  before: Store,
  after: Store,
  workspace: PriceCalculatorCurrency,
  shippingTakenOut?: ShippingTakenOut,
) {
  const shipping = shippingTakenOut ? (1 + shippingTakenOut.from) / (1 + shippingTakenOut.to) : 1
  return consumables.map((item) => {
    if (item.storeId !== before.id) return item
    const price = convertedPrice(consumablePrice(item), before, after, workspace)
    return withConsumablePrice(item, shipping === 1 ? price : roundedPrice(price * shipping))
  })
}

function storeOf(consumable: Consumable, stores: Store[]) {
  return consumable.storeId === undefined ? undefined : stores.find(({ id }) => id === consumable.storeId)
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
    const store = storeOf(consumable, stores)
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
