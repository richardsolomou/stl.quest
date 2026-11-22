import { wearPartsFor, type Consumable, type PartConsumable } from './consumables'
import type { PrinterRunCount } from './printJobs'
import type { PrinterProfile } from './types'

/** From this share of its lifespan something reads as nearly worn, so a replacement can be ordered in time. */
export const NEARLY_WORN = 0.8

export type WearLevel = 'fresh' | 'nearly' | 'due'

export function wearLevel(used: number, lifespan: number): WearLevel {
  if (!(lifespan > 0)) return 'fresh'
  if (used >= lifespan) return 'due'
  return used >= lifespan * NEARLY_WORN ? 'nearly' : 'fresh'
}

/** Printing runs summed: their minutes, and their copies, each of which is a plate. */
export type RunTotal = { minutes: number; plates: number }

/**
 * What the usage log says of each printer's runs, as the repository aggregates it. A run is a live printing use of the
 * printer itself, failed ones included as they wore it too; the material and part events a print recorded beside it,
 * including those of a deleted part, are not runs.
 */
export type MaintenanceTotals = {
  /** Every run per printer in `all`, and in `recorded` those recorded at a step rather than estimated for a past print. */
  printers: { printerId: string; all: RunTotal; recorded: RunTotal }[]
  /** Each part's last live replacement on a printer, and the recorded runs on that printer since. */
  replacements: { printerId: string; consumableId: string; replacedAt: number; since: RunTotal }[]
}

export type PartWear = {
  consumableId: string
  /** Plates or print hours, in the part's lifespan unit, since it was last replaced on the printer. */
  used: number
  lifespan: number
  unit: PartConsumable['lifespanUnit']
  /** When it was last replaced on the printer; absent when the log has no replacement. */
  replacedAt?: number
  level: WearLevel
}

export type PrinterLifetime = {
  printerId: string
  /** Its plate runs as Bambuddy reported them, when it has any. */
  runs?: PrinterRunCount
  /**
   * Print hours run, estimates of past prints included: unlike a part, the printer was there for all of them, and their
   * cost already charged its wear.
   */
  hours: number
  lifespanHours?: number
  level: WearLevel
  /** Its wear parts, most worn first. */
  parts: PartWear[]
}

const NO_RUNS: RunTotal = { minutes: 0, plates: 0 }

/**
 * How worn one part is on one printer, from the printer's recorded runs since the part's last replacement there, or
 * all of them when none is logged. Estimates of past prints never count, since no replacement before them was recorded.
 */
export function partWear(totals: MaintenanceTotals, printerId: string, part: PartConsumable): PartWear {
  const replacement = totals.replacements.find((entry) => entry.printerId === printerId && entry.consumableId === part.id)
  const runs = replacement?.since ?? totals.printers.find((entry) => entry.printerId === printerId)?.recorded ?? NO_RUNS
  const used = part.lifespanUnit === 'plates' ? runs.plates : runs.minutes / 60
  return {
    consumableId: part.id,
    used,
    lifespan: part.lifespan,
    unit: part.lifespanUnit,
    ...(replacement && { replacedAt: replacement.replacedAt }),
    level: wearLevel(used, part.lifespan),
  }
}

/** How far through its life each printer and each of its wear parts is. */
export function printerLifetimes(totals: MaintenanceTotals, printers: PrinterProfile[], consumables: Consumable[]): PrinterLifetime[] {
  return printers.map((printer) => {
    const hours = (totals.printers.find((entry) => entry.printerId === printer.id)?.all.minutes ?? 0) / 60
    const parts = wearPartsFor(consumables, printer.printType, printer)
      .map((part) => partWear(totals, printer.id, part))
      .sort((left, right) => wornShare(right) - wornShare(left))
    return {
      printerId: printer.id,
      hours,
      ...(printer.lifespanHours && { lifespanHours: printer.lifespanHours }),
      level: wearLevel(hours, printer.lifespanHours ?? 0),
      parts,
    }
  })
}

/**
 * What on a printer most needs attention: being past its own lifespan, then its most worn part once nearly worn, then
 * nearing its lifespan.
 */
export function printerAttention(lifetime: PrinterLifetime): { level: Exclude<WearLevel, 'fresh'>; part?: PartWear } | undefined {
  const part = lifetime.parts[0]
  if (lifetime.level === 'due') return { level: 'due' }
  if (part && part.level !== 'fresh') return { level: part.level, part }
  return lifetime.level === 'nearly' ? { level: 'nearly' } : undefined
}

/** Every part nearly worn or due across the printers, most worn first. */
export function wearingParts(lifetimes: PrinterLifetime[]) {
  return lifetimes
    .flatMap(({ printerId, parts }) => parts.filter(({ level }) => level !== 'fresh').map((wear) => ({ printerId, wear })))
    .sort((left, right) => wornShare(right.wear) - wornShare(left.wear))
}

function wornShare(wear: PartWear) {
  return wear.lifespan > 0 ? wear.used / wear.lifespan : 0
}

/** Whole years and months from a purchase date to today, both calendar dates (`YYYY-MM-DD`); never negative. */
/**
 * Whether a `YYYY-MM-DD` purchase date is not in the future anywhere: up to tomorrow in UTC, which is already today in
 * the easternmost time zones.
 */
export function isPastPurchaseDate(purchasedOn: string, now: number) {
  return purchasedOn <= new Date(now + 86_400_000).toISOString().slice(0, 10)
}

export function ownedFor(purchasedOn: string, today: string) {
  const [boughtYear, boughtMonth, boughtDay] = purchasedOn.split('-').map(Number)
  const [year, month, day] = today.split('-').map(Number)
  const months = Math.max(0, (year - boughtYear) * 12 + (month - boughtMonth) - (day < boughtDay ? 1 : 0))
  return { years: Math.floor(months / 12), months: months % 12 }
}
