import { consumableUnit, consumableUnitPrice, type Consumable } from './consumables'
import { enteredUnitScale, packSize } from './stock'
import type { Store } from './stores'
import type { StockLevel, UsageUnit } from './usage'

const DAY = 86_400_000

/** How far back the usage rate looks. */
export const USAGE_RATE_DAYS = 30
/** How long stock must have been logged before its usage rate is trusted. */
export const MIN_USAGE_HISTORY_DAYS = 7
/** Stock that lasts fewer days than this at the recent rate is worth buying, even above its minimum. */
export const BUY_AHEAD_DAYS = 14
/** How many days of use one purchase aims to cover. */
export const STOCK_UP_DAYS = 30

/**
 * One consumable's live, recorded stock log in one unit, as the repository aggregates it: what uses, waste, and
 * replacements took since the rate window opened, and when its first event was logged.
 */
export type RecentStockUse = { consumableId: string; unit: UsageUnit; used: number; firstAt: number }

/**
 * How much of a consumable goes per day at its recent rate, in its stock unit, or undefined until its stock has been
 * logged long enough to say, or when nothing was used lately. A log younger than the window is averaged over its own age.
 */
export function dailyUse(consumable: Consumable, uses: RecentStockUse[], now: number) {
  const unit = consumableUnit(consumable)
  const own = uses.find((use) => use.consumableId === consumable.id && use.unit === unit)
  if (!own || own.used <= 0) return undefined
  const days = Math.min(USAGE_RATE_DAYS, (now - own.firstAt) / DAY)
  return days < MIN_USAGE_HISTORY_DAYS ? undefined : own.used / days
}

export type ShoppingItem = {
  consumable: Consumable
  level: StockLevel
  /** Days of supply left at the recent rate, when that is known. */
  daysLeft?: number
  /** How many packs to buy, of `pack` each in the consumable's stock unit. */
  packs: number
  pack: number
  cost: number
}

export type ShoppingGroup = {
  /** Absent for what names no store in use. */
  store?: Store
  items: ShoppingItem[]
  subtotal: number
  /** What shipping adds to this order; undefined when the store has no shipping cost set. */
  shipping?: number
  /** How much more this order needs before it ships free; absent once it does, or when the store sets no threshold. */
  toFreeShipping?: number
  /**
   * While the order is short of free shipping, a pack each of what else is tracked from the store, soonest to run out
   * first, until they would make it ship free; all of them when even that falls short.
   */
  topUp?: ShoppingItem[]
}

/**
 * What to buy, by store: every tracked consumable in use that is gone, below its minimum, or due to run out within
 * `BUY_AHEAD_DAYS` at its recent rate, the most urgent first. Each comes in whole packs that bring it up to its minimum
 * or `STOCK_UP_DAYS` of use, whichever is more. Stores keep their own order, and what names no store in use comes last.
 */
export function shoppingList(input: {
  consumables: Consumable[]
  levels: StockLevel[]
  stores: Store[]
  /** Per consumable ID, from `dailyUse`. */
  rates: ReadonlyMap<string, number>
}): ShoppingGroup[] {
  const levels = new Map(input.levels.map((level) => [level.consumableId, level]))
  const tracked = input.consumables.flatMap((consumable) => {
    const level = levels.get(consumable.id)
    if (consumable.archived || !level?.tracked) return []
    const rate = input.rates.get(consumable.id)
    return [{ consumable, level, rate, ...(rate && { daysLeft: Math.max(0, level.onHand) / rate }) }]
  })
  const needed = tracked.filter(
    ({ level, daysLeft }) => level.missing || level.low || (daysLeft !== undefined && daysLeft < BUY_AHEAD_DAYS),
  )
  const items = needed.map(({ consumable, level, rate, daysLeft }) => {
    const pack = packOf(consumable)
    const target = Math.max(level.minimum ?? 0, (rate ?? 0) * STOCK_UP_DAYS)
    return shoppingItem(consumable, level, daysLeft, Math.max(1, Math.ceil((target - level.onHand) / pack)))
  })
  const spare = tracked
    .filter((entry) => !needed.includes(entry) && consumableUnitPrice(entry.consumable) > 0)
    .map(({ consumable, level, daysLeft }) => shoppingItem(consumable, level, daysLeft, 1))
  items.sort(byUrgency)
  spare.sort(byUrgency)
  const active = input.stores.filter((store) => !store.archived)
  const storeOf = (item: ShoppingItem) => active.find(({ id }) => id === item.consumable.storeId)
  return [...active, undefined].flatMap((store) => {
    const own = items.filter((item) => storeOf(item) === store)
    return own.length ? [group(store, own, store ? spare.filter((item) => storeOf(item) === store) : [])] : []
  })
}

function packOf(consumable: Consumable) {
  return packSize(consumable) ?? enteredUnitScale(consumableUnit(consumable))
}

function shoppingItem(consumable: Consumable, level: StockLevel, daysLeft: number | undefined, packs: number): ShoppingItem {
  const pack = packOf(consumable)
  return {
    consumable,
    level,
    ...(daysLeft !== undefined && { daysLeft }),
    packs,
    pack,
    cost: packs * pack * consumableUnitPrice(consumable),
  }
}

function group(store: Store | undefined, items: ShoppingItem[], spare: ShoppingItem[]): ShoppingGroup {
  const subtotal = items.reduce((total, item) => total + item.cost, 0)
  const threshold = store?.freeShippingOver
  const free = threshold !== undefined && subtotal >= threshold
  const short = threshold !== undefined && !free ? threshold - subtotal : undefined
  return {
    ...(store && { store }),
    items,
    subtotal,
    ...(store?.shippingCost !== undefined && { shipping: free ? 0 : store.shippingCost }),
    ...(short !== undefined && { toFreeShipping: short, topUp: topUp(spare, short) }),
  }
}

function topUp(spare: ShoppingItem[], short: number) {
  const picked: ShoppingItem[] = []
  let added = 0
  for (const item of spare) {
    if (added >= short) break
    picked.push(item)
    added += item.cost
  }
  return picked
}

/** Gone first, then the fewest days left, then the furthest below its minimum. */
function byUrgency(a: ShoppingItem, b: ShoppingItem) {
  const fill = ({ level }: ShoppingItem) => (level.minimum ? level.onHand / level.minimum : 1)
  return (
    Number(b.level.missing) - Number(a.level.missing) ||
    (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY) ||
    fill(a) - fill(b)
  )
}
