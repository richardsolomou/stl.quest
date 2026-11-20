import { consumableUnit, consumableUnitPrice, wearPartsFor, type Consumable } from './consumables'
import { equipmentPrintType, supplyUnit, supplyUnitPrice, type EquipmentItem } from './equipment'
import {
  equipmentCostPerMinute,
  printerCostPerMinute,
  type CostedPrinter,
  type PriceCalculatorCurrency,
  type PriceCalculatorSettings,
} from './priceCalculator'
import type { PrinterProfile, PrintType } from './types'

/**
 * What a workspace used, as an append-only log: one event per thing used or moved in or out of stock. Stock, per-print
 * cost and spend are read from it, and each event keeps the unit price it was used at, so later price edits never
 * rewrite history. A move that recorded usage shares one transaction ID across its events, so undoing it is exact.
 */

export const USAGE_STAGES = ['printing', 'finishing', 'stock'] as const
export type UsageStage = (typeof USAGE_STAGES)[number]

/** `use` consumes for a print; `restock` adds what was bought; `correction` sets stock straight after counting or weighing; `waste` is lost stock; `replace` takes a spare part off the shelf to swap a worn one, and resets that part's wear count on the printer. */
export const USAGE_KINDS = ['use', 'restock', 'correction', 'waste', 'replace'] as const
export type UsageKind = (typeof USAGE_KINDS)[number]

export const USAGE_UNITS = ['ml', 'g', 'item', 'minute', 'plate'] as const
export type UsageUnit = (typeof USAGE_UNITS)[number]

export const USAGE_OUTCOMES = ['completed', 'failed'] as const
export type UsageOutcome = (typeof USAGE_OUTCOMES)[number]

export type UsageEvent = {
  id: string
  /** Shared by every event one action recorded, so the action can be undone as a whole. */
  transactionId: string
  stage: UsageStage
  kind: UsageKind
  /** The print it was used for; absent for stock movements. */
  requestId?: string
  printerId?: string
  equipmentId?: string
  consumableId?: string
  /** Signed for corrections; positive otherwise. */
  amount: number
  unit: UsageUnit
  copies?: number
  outcome?: UsageOutcome
  /** Price per unit when it was used, in the workspace currency; absent when the item had no price. */
  unitPrice?: number
  currency?: PriceCalculatorCurrency
  userId?: string
  createdAt: number
  undoneAt?: number
}

/** What a step records: the printer and material when printing starts, the equipment when finishing. */
export type StepUsageInput = {
  requestId: string
  stage: Exclude<UsageStage, 'stock'>
  copies: number
  printerId?: string
  consumableId?: string
  equipmentIds?: string[]
  outcome?: UsageOutcome
}

/** How an event of each kind moves stock: restocks and signed corrections add, uses, waste, and replacements subtract. */
export function stockEffect(kind: UsageKind) {
  return kind === 'restock' || kind === 'correction' ? 1 : -1
}

/** A stock movement outside any print: a correction gives the amount counted or weighed, and the log records the difference. */
export type StockMovementInput =
  | { consumableId: string; kind: 'restock' | 'waste'; amount: number }
  | { consumableId: string; kind: 'replace'; amount: number; printerId?: string }
  | { consumableId: string; kind: 'correction'; counted: number }

/**
 * Stock on hand for one consumable from its live events in the unit it is stocked in: restocks add, uses, waste, and
 * replacements subtract, a correction adds its signed amount. A wear part's use by the plate or minute is wear, not stock.
 */
export function stockOnHand(events: UsageEvent[], consumable: Consumable) {
  const unit = consumableUnit(consumable)
  return events.reduce(
    (total, event) =>
      event.undoneAt || event.consumableId !== consumable.id || event.unit !== unit
        ? total
        : total + stockEffect(event.kind) * event.amount,
    0,
  )
}

/** What an event cost, from the price it was used at. */
export function usageCost(event: UsageEvent) {
  return event.unitPrice === undefined || event.undoneAt ? 0 : event.amount * event.unitPrice
}

export const MAX_USAGE_LIST = 1_000

/** Which events to list, newest first; `from` and `to` bound `createdAt` in epoch milliseconds, `to` exclusive. */
export type UsageFilters = {
  requestId?: string
  consumableId?: string
  printerId?: string
  equipmentId?: string
  from?: number
  to?: number
  includeUndone?: boolean
  limit?: number
}

/** An event before the action that records it stamps its IDs, user, currency, and time. */
export type UsageDraft = Omit<UsageEvent, 'id' | 'transactionId' | 'currency' | 'userId' | 'createdAt' | 'undoneAt'>

/**
 * The events one step records, each priced as the calculator quotes it now. Printing records the printer's minutes (the
 * per-copy estimate times the copies, or none when the estimate lacks them, so its last use is still known), the
 * material when the estimate knows it, and the wear of its model's parts by the plate or print minute. Each piece of
 * equipment records its minutes per use and its supplies' amounts per use once per copy: every copy counts as its own
 * plate, since a print does not say how many copies share one.
 */
export function stepUsageDrafts(
  input: StepUsageInput,
  resolved: {
    rates: Pick<PriceCalculatorSettings, 'electricityPricePerKwh'>
    printer?: CostedPrinter
    estimate?: { material?: number; minutes?: number }
    material?: Consumable
    equipment: EquipmentItem[]
    consumables: Consumable[]
  },
): UsageDraft[] {
  const { requestId, stage, copies, outcome } = input
  const { rates, printer } = resolved
  const base = { requestId, stage, kind: 'use' as const, copies, ...(outcome && { outcome }) }
  const drafts: UsageDraft[] = []
  const estimatedMinutes = resolved.estimate?.minutes
  const minutes = positive(estimatedMinutes) ? estimatedMinutes * copies : 0
  if (printer) {
    drafts.push({ ...base, printerId: printer.id, amount: minutes, unit: 'minute', ...priced(printerCostPerMinute(rates, printer)) })
    for (const part of wearPartsFor(resolved.consumables, printer.printType, printer)) {
      const wear = supplied(part)
      const amount = wear.unit === 'plate' ? copies : minutes
      if (amount > 0) drafts.push({ ...base, printerId: printer.id, ...wear, amount })
    }
  }
  const material = resolved.estimate?.material
  if (resolved.material && positive(material)) {
    drafts.push({ ...base, ...(printer && { printerId: printer.id }), ...consumed(resolved.material), amount: material * copies })
  }
  const consumables = new Map(resolved.consumables.map((consumable) => [consumable.id, consumable]))
  for (const item of resolved.equipment) {
    drafts.push({
      ...base,
      equipmentId: item.id,
      amount: Math.max(0, item.minutesPerUse) * copies,
      unit: 'minute',
      ...priced(equipmentCostPerMinute(rates, item)),
    })
    for (const supply of item.supplies) {
      const consumable = consumables.get(supply.consumableId)
      if (!consumable || !positive(supply.amountPerUse)) continue
      drafts.push({ ...base, equipmentId: item.id, ...supplied(consumable), amount: supply.amountPerUse * copies })
    }
  }
  return drafts
}

/** What the step sheets prefill from: the last printer per print type, material per printer, and finishing set per print type. */
export type UsagePrefills = {
  printers: Partial<Record<PrintType, string>>
  materials: Record<string, string>
  finishing: Partial<Record<PrintType, string[]>>
}

/**
 * The most recent choices in the log, limited to printers and equipment still in use. A finishing step takes its print
 * type from the printer its print was last recorded on, or else from equipment that serves only one print type.
 */
export function usagePrefills(
  events: UsageEvent[],
  printers: Pick<PrinterProfile, 'id' | 'printType' | 'archived'>[],
  equipment: EquipmentItem[],
): UsagePrefills {
  const activePrinters = new Map(printers.filter(({ archived }) => !archived).map((printer) => [printer.id, printer]))
  const activeEquipment = new Map(equipment.filter(({ archived }) => !archived).map((item) => [item.id, item]))
  const newest = events.filter((event) => !event.undoneAt && event.kind === 'use').sort((left, right) => right.createdAt - left.createdAt)
  const prefills: UsagePrefills = { printers: {}, materials: {}, finishing: {} }
  const requestPrintTypes = new Map<string, PrintType>()
  for (const event of newest) {
    const printer = event.stage === 'printing' && event.printerId ? activePrinters.get(event.printerId) : undefined
    if (!printer) continue
    prefills.printers[printer.printType] ??= printer.id
    if (event.requestId && !requestPrintTypes.has(event.requestId)) requestPrintTypes.set(event.requestId, printer.printType)
    if (event.consumableId && (event.unit === 'ml' || event.unit === 'g')) prefills.materials[printer.id] ??= event.consumableId
  }
  const finishingSets = new Map<string, { requestId?: string; ids: string[] }>()
  for (const event of newest) {
    if (event.stage !== 'finishing' || !event.equipmentId || event.consumableId || !activeEquipment.has(event.equipmentId)) continue
    const set = finishingSets.get(event.transactionId) ?? { requestId: event.requestId, ids: [] }
    if (!set.ids.includes(event.equipmentId)) set.ids.push(event.equipmentId)
    finishingSets.set(event.transactionId, set)
  }
  for (const { requestId, ids } of finishingSets.values()) {
    const served = new Set(
      ids.map((id) => {
        const item = activeEquipment.get(id)
        return item && equipmentPrintType(item)
      }),
    )
    const onlyServed = served.size === 1 ? [...served][0] : undefined
    const printType = (requestId ? requestPrintTypes.get(requestId) : undefined) ?? onlyServed
    if (printType) prefills.finishing[printType] ??= ids
  }
  return prefills
}

/** Summed amounts of one consumable's live events of one kind and unit, as the repository aggregates them. */
export type StockTotal = { consumableId: string; kind: UsageKind; unit: UsageUnit; amount: number }

export type StockLevel = {
  consumableId: string
  unit: UsageUnit
  onHand: number
  minimum?: number
  /** Whether it was ever stocked or counted, or has a minimum; usage alone never starts tracking, so an item used in prints but never stocked is not flagged as empty. */
  tracked: boolean
  low: boolean
  missing: boolean
}

/**
 * Stock on hand per consumable, counting only events in the unit it is stocked in now, so a wear part's use by the plate
 * never counts as items and changing a supply's unit never mixes millilitres with items. It is missing at or below zero and low below its minimum.
 */
export function stockLevels(consumables: Consumable[], totals: StockTotal[]): StockLevel[] {
  return consumables.map((consumable) => {
    const unit = consumableUnit(consumable)
    const own = totals.filter((total) => total.consumableId === consumable.id && total.unit === unit)
    const onHand = own.reduce((sum, total) => sum + stockEffect(total.kind) * total.amount, 0)
    const minimum = consumable.minimumStock
    const tracked = own.some((total) => total.kind === 'restock' || total.kind === 'correction') || minimum !== undefined
    const missing = tracked && onHand <= 0
    return {
      consumableId: consumable.id,
      unit,
      onHand,
      ...(minimum !== undefined && { minimum }),
      tracked,
      missing,
      low: tracked && !missing && minimum !== undefined && onHand < minimum,
    }
  })
}

/** The consumable a stock movement or material use moves, in its stock unit at its price now. */
export function consumed(consumable: Consumable) {
  return { consumableId: consumable.id, unit: consumableUnit(consumable), ...priced(consumableUnitPrice(consumable)) }
}

/** A supply or wear part as equipment and printers use it, in the unit and at the price the calculator quotes it. */
function supplied(consumable: Consumable) {
  return { consumableId: consumable.id, unit: supplyUnit(consumable), ...priced(supplyUnitPrice(consumable)) }
}

/** An unpriced item records no price. */
function priced(unitPrice: number) {
  return unitPrice > 0 ? { unitPrice } : {}
}

function positive(value?: number): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0
}
