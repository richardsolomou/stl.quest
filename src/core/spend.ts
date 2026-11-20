import type { Consumable } from './consumables'
import type { PriceCalculatorCurrency } from './priceCalculator'
import type { PrintCharge } from './types'
import { usageCost, type UsageEvent, type UsageStage, type UsageUnit } from './usage'

/**
 * What a workspace spent, read from its usage log at the prices each event recorded. Uses, waste, and replaced parts
 * cost money; restocks are purchases and corrections only set counts straight, so neither counts as spend.
 */

export const SPEND_CATEGORIES = ['material', 'printer', 'equipment', 'supply', 'part'] as const
export type SpendCategory = (typeof SPEND_CATEGORIES)[number]

/** Spent in a print that finished, in a run that failed, or as stock lost outside any print. */
export const SPEND_OUTCOMES = ['used', 'failed', 'wasted'] as const
export type SpendOutcome = (typeof SPEND_OUTCOMES)[number]

export function isSpend(event: UsageEvent) {
  return !event.undoneAt && (event.kind === 'use' || event.kind === 'waste' || event.kind === 'replace')
}

/**
 * A consumable that left the library keeps its place by how it was used: wear by the plate or minute, or a replacement,
 * is a part; otherwise material while printing and a supply after.
 */
export function spendCategory(event: UsageEvent, consumables: ReadonlyMap<string, Consumable>): SpendCategory {
  if (!event.consumableId) return event.equipmentId ? 'equipment' : 'printer'
  const kind = consumables.get(event.consumableId)?.kind
  if (kind === 'resin' || kind === 'filament') return 'material'
  if (kind === 'supply') return 'supply'
  if (kind === 'part' || event.kind === 'replace' || event.unit === 'plate' || event.unit === 'minute') return 'part'
  return event.stage === 'printing' ? 'material' : 'supply'
}

export function spendOutcome(event: UsageEvent): SpendOutcome {
  return event.kind === 'waste' ? 'wasted' : event.outcome === 'failed' ? 'failed' : 'used'
}

/**
 * Where a printing cost's numbers came from: a plate's slicer totals, or the print's estimate (recorded at the step
 * sheet or filled in for a past print). Finishing and stock record what was set per use, so they have no basis.
 */
export function costBasis(event: UsageEvent): 'slicer' | 'estimate' | undefined {
  if (event.plateId) return 'slicer'
  return event.stage === 'printing' && event.kind === 'use' ? 'estimate' : undefined
}

/** Whether an event belongs with spend in this currency: priced in it, or not priced at all. Spend is never converted. */
function inCurrency(event: UsageEvent, currency: PriceCalculatorCurrency) {
  return !event.currency || event.currency === currency
}

export type CurrencyTotal = { currency: PriceCalculatorCurrency; total: number }

export type SpendItem = { category: SpendCategory; id?: string; unit: UsageUnit; amount: number; cost: number }
export type PrintSpend = { requestId: string; cost: number; failed: boolean; estimated: boolean; slicer: boolean }

export type SpendSummary = {
  total: number
  /** The part of the total whose printing was taken from print estimates. */
  estimated: number
  /** The part of the total split from slicer totals on plates. */
  slicer: number
  categories: Record<SpendCategory, number>
  outcomes: Record<SpendOutcome, number>
  /** Each thing used, most spent first. */
  items: SpendItem[]
  /** Each print, most spent first. */
  prints: PrintSpend[]
  /** Consumables used without a price, which count as nothing. */
  unpriced: number
  /** Spend priced in currencies the workspace no longer uses, each kept apart from the rest, most spent first. */
  otherCurrencies: CurrencyTotal[]
}

/**
 * Spend in the workspace's currency, broken down; spend recorded in any other currency is totalled on its own in
 * `otherCurrencies` and left out of everything else.
 */

export function summariseSpend(events: UsageEvent[], consumables: Consumable[], currency: PriceCalculatorCurrency): SpendSummary {
  const library = new Map(consumables.map((consumable) => [consumable.id, consumable]))
  const categories = Object.fromEntries(SPEND_CATEGORIES.map((category) => [category, 0])) as Record<SpendCategory, number>
  const outcomes = Object.fromEntries(SPEND_OUTCOMES.map((outcome) => [outcome, 0])) as Record<SpendOutcome, number>
  const items = new Map<string, SpendItem>()
  const prints = new Map<string, PrintSpend>()
  let total = 0
  let estimated = 0
  let slicer = 0
  let unpriced = 0
  const others = new Map<PriceCalculatorCurrency, number>()
  for (const event of events) {
    if (!isSpend(event)) continue
    if (event.consumableId && event.unitPrice === undefined && event.amount > 0) unpriced++
    if (event.currency && !inCurrency(event, currency)) {
      others.set(event.currency, (others.get(event.currency) ?? 0) + usageCost(event))
      continue
    }
    const cost = usageCost(event)
    const category = spendCategory(event, library)
    total += cost
    const basis = costBasis(event)
    if (basis === 'estimate') estimated += cost
    if (basis === 'slicer') slicer += cost
    categories[category] += cost
    outcomes[spendOutcome(event)] += cost
    const id = event.consumableId ?? event.equipmentId ?? event.printerId
    const key = `${category}:${id ?? ''}:${event.unit}`
    const item = items.get(key) ?? { category, ...(id && { id }), unit: event.unit, amount: 0, cost: 0 }
    item.amount += event.amount
    item.cost += cost
    items.set(key, item)
    if (event.requestId) {
      const print = prints.get(event.requestId) ?? { requestId: event.requestId, cost: 0, failed: false, estimated: false, slicer: false }
      print.cost += cost
      print.failed ||= event.outcome === 'failed'
      print.estimated ||= basis === 'estimate'
      print.slicer ||= basis === 'slicer'
      prints.set(event.requestId, print)
    }
  }
  return {
    total,
    estimated,
    slicer,
    categories,
    outcomes,
    items: [...items.values()].sort((a, b) => b.cost - a.cost || b.amount - a.amount),
    prints: [...prints.values()].sort((a, b) => b.cost - a.cost),
    unpriced,
    otherCurrencies: [...others].map(([other, spent]) => ({ currency: other, total: spent })).sort((a, b) => b.total - a.total),
  }
}

/**
 * A print with a charge over its whole life: what its live usage priced in the workspace currency (or unpriced) cost in
 * every period, and when the last of that usage was recorded, which is when it finished; absent when it has none.
 */
export type ChargedPrint = { requestId: string; charged: PrintCharge; cost: number; finishedAt?: number }

export type ProfitSummary = {
  earned: number
  /** Everything the counted prints used, in every period. */
  spent: number
  profit: number
  /** How many prints were counted. */
  charged: number
  /** Whether any print has a charge in the workspace currency, whatever the period. */
  recorded: boolean
  byPrint: Map<string, number>
}

/**
 * What the prints that finished in the period were charged against everything they used, so a print printed across
 * two periods counts once, where it finished. Prints with no usage never finished, and charges in another currency are
 * left out, so neither counts.
 */
export function summariseProfit(prints: ChargedPrint[], period: SpendPeriod, currency: PriceCalculatorCurrency): ProfitSummary {
  const byPrint = new Map<string, number>()
  let earned = 0
  let spent = 0
  let recorded = false
  for (const { requestId, charged, cost, finishedAt } of prints) {
    if (charged.currency !== currency) continue
    recorded = true
    if (finishedAt === undefined || finishedAt < period.from || finishedAt >= period.to) continue
    earned += charged.amount
    spent += cost
    byPrint.set(requestId, charged.amount - cost)
  }
  return { earned, spent, profit: earned - spent, charged: byPrint.size, recorded, byPrint }
}

/** One recorded action on a print, such as moving it to Printing: who did it, when, and what it used. */
export type UsageStep = {
  transactionId: string
  stage: UsageStage
  createdAt: number
  userId?: string
  copies?: number
  failed: boolean
  /** Filled in from a past print's estimate rather than recorded at the step. */
  estimated: boolean
  /** In the step's own currency: one action prices all its events in the currency the workspace had then. */
  cost: number
  /** Absent when nothing in the step had a price. */
  currency?: PriceCalculatorCurrency
  events: UsageEvent[]
}

/** A print's recorded steps, oldest first. */
export function usageSteps(events: UsageEvent[]): UsageStep[] {
  const steps = new Map<string, UsageStep>()
  for (const event of events) {
    if (!isSpend(event)) continue
    const step = steps.get(event.transactionId) ?? {
      transactionId: event.transactionId,
      stage: event.stage,
      createdAt: event.createdAt,
      ...(event.userId && { userId: event.userId }),
      ...(event.copies !== undefined && { copies: event.copies }),
      failed: false,
      estimated: false,
      cost: 0,
      events: [],
    }
    step.failed ||= event.outcome === 'failed'
    step.estimated ||= Boolean(event.estimated)
    step.cost += usageCost(event)
    if (event.currency) step.currency ??= event.currency
    step.events.push(event)
    steps.set(event.transactionId, step)
  }
  return [...steps.values()].sort((a, b) => a.createdAt - b.createdAt)
}

export const SPEND_PERIODS = ['month', '30-days', '3-months', 'custom'] as const
export type SpendPeriodPreset = (typeof SPEND_PERIODS)[number]

/** Epoch milliseconds, `from` inclusive and `to` exclusive, on local day boundaries. */
export type SpendPeriod = { from: number; to: number }

/** A `YYYY-MM-DD` date as the start of that local day, or undefined when it is not a real date. */
export function localDay(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return undefined
  const [year, month, day] = match.slice(1).map(Number)
  const start = new Date(year, month - 1, day)
  return start.getFullYear() === year && start.getMonth() === month - 1 && start.getDate() === day ? start.getTime() : undefined
}

/** A time as the `YYYY-MM-DD` of its local day. */
export function dayString(time: number) {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function startOfDay(time: number, plusDays = 0) {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + plusDays).getTime()
}

/** Every preset runs to the end of today; a custom range covers both of its days, in either order. */
export function spendPeriod(preset: SpendPeriodPreset, now: number, custom?: { from?: string; to?: string }): SpendPeriod {
  const to = startOfDay(now, 1)
  const today = new Date(now)
  if (preset === 'month') return { from: new Date(today.getFullYear(), today.getMonth(), 1).getTime(), to }
  if (preset === '30-days') return { from: startOfDay(now, -29), to }
  if (preset === '3-months') return { from: new Date(today.getFullYear(), today.getMonth() - 3, today.getDate() + 1).getTime(), to }
  const first = localDay(custom?.from ?? '') ?? startOfDay(now, -29)
  const last = localDay(custom?.to ?? '') ?? startOfDay(now)
  return { from: Math.min(first, last), to: startOfDay(Math.max(first, last), 1) }
}

export type SpendBucket = { start: number; end: number; cost: number }
export const SPEND_DAILY_LIMIT_DAYS = 62

/** Spend in one currency per local day across the period, or per week from its first day once it runs longer than two months. */
export function spendTrend(events: UsageEvent[], period: SpendPeriod, currency: PriceCalculatorCurrency): SpendBucket[] {
  const days = Math.round((period.to - period.from) / 86_400_000)
  const step = days > SPEND_DAILY_LIMIT_DAYS ? 7 : 1
  const buckets: SpendBucket[] = []
  for (let start = period.from; start < period.to;) {
    const end = Math.min(startOfDay(start, step), period.to)
    buckets.push({ start, end, cost: 0 })
    start = end
  }
  for (const event of events) {
    if (!isSpend(event) || !inCurrency(event, currency)) continue
    const bucket = buckets.find(({ start, end }) => event.createdAt >= start && event.createdAt < end)
    if (bucket) bucket.cost += usageCost(event)
  }
  return buckets
}
