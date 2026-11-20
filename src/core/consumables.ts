import { PRINT_TYPES, type PrinterProfile, type PrintType } from './types'
import type { UsageUnit } from './usage'

export const MAX_CONSUMABLES = 200

/** What every consumable carries; amounts are in the consumable's own unit (see `consumableUnit`). */
type LibraryFields = {
  /** Kept so usage that names it still resolves, but left out of pickers, pricing, and stock needs. */
  archived?: boolean
  /** Below this much on hand it counts as running low. */
  minimumStock?: number
  /** How much one bottle, spool, box, or pack holds, so restocking can count what was bought. */
  packSize?: number
}

export type ResinConsumable = LibraryFields & {
  id: string
  kind: 'resin'
  name: string
  resinPresetId?: string
  pricePerLitre: number
  densityGramsPerMl: number
}

export type FilamentColour = { name: string; hex: string }

/** A catalogued filament takes its name from the preset and colour; `name` is typed only for one the catalogue lacks. */
export type FilamentConsumable = LibraryFields & {
  id: string
  kind: 'filament'
  name: string
  filamentPresetId?: string
  colour?: FilamentColour
  pricePerKg: number
}

/** A part that wears out, such as a resin tank or build plate, costed across the plates or print hours it lasts. */
export type PartConsumable = LibraryFields & {
  id: string
  kind: 'part'
  name: string
  printType: PrintType
  price: number
  lifespan: number
  lifespanUnit: 'plates' | 'hours'
  /** The catalogue printer model the part belongs to; with no `printerId` either, it fits every printer of its print type. */
  printerPresetId?: string
  /** The custom printer, one without a catalogue model, that the part belongs to alone. */
  printerId?: string
  /** The catalogue part it was added from. */
  partPresetId?: string
}

export const SUPPLY_UNITS = ['ml', 'g', 'item'] as const satisfies UsageUnit[]
export type SupplyUnit = (typeof SUPPLY_UNITS)[number]

/**
 * Something used up around printing, such as IPA or gloves, measured in the unit equipment uses it in. `price` is per
 * litre for `ml`, per kilogram for `g`, and per item for `item`, which is how supplies are bought.
 */
export type SupplyConsumable = LibraryFields & {
  id: string
  kind: 'supply'
  name: string
  unit: SupplyUnit
  price: number
}

export type Consumable = ResinConsumable | FilamentConsumable | PartConsumable | SupplyConsumable

export const CONSUMABLE_KINDS = ['resin', 'filament', 'part', 'supply'] as const satisfies Consumable['kind'][]

/** The consumables of a kind still in use, in library order, so the first is the one a quote uses when none is picked. */
export function consumablesOfKind<Kind extends Consumable['kind']>(consumables: Consumable[], kind: Kind) {
  return consumables.filter(
    (consumable): consumable is Extract<Consumable, { kind: Kind }> => consumable.kind === kind && !consumable.archived,
  )
}

/** Whether a part belongs to every printer of its print type rather than to a model or a printer of its own. */
function fitsEveryPrinter(part: PartConsumable) {
  return part.printerPresetId === undefined && part.printerId === undefined
}

/**
 * The parts a printer wears: those of its print type that belong to no model or printer, plus those of its own model
 * or, for a custom printer, its own.
 */
export function wearPartsFor(consumables: Consumable[], printType: PrintType, printer: { id?: string; presetId?: string } = {}) {
  return consumablesOfKind(consumables, 'part').filter(
    (part) =>
      part.printType === printType &&
      (fitsEveryPrinter(part) ||
        (part.printerId !== undefined ? part.printerId === printer.id : part.printerPresetId === printer.presetId)),
  )
}

/** What wear parts belong to: every printer of a print type, one catalogue printer model, or one custom printer. */
export type WearPartGroup = {
  printType: PrintType
  printerPresetId?: string
  printerId?: string
  /** Active printers the group's parts apply to; none for a model or custom printer that has left the fleet. */
  printers: number
  parts: PartConsumable[]
}

/**
 * Wear parts by what they belong to: each print type the workspace prints or owns a printer or part of, each catalogue
 * model in the fleet, each custom printer in it, then each model or custom printer that has left the fleet but still
 * has parts.
 */
export function wearPartGroups(consumables: Consumable[], fleet: PrinterProfile[], printTypes: readonly PrintType[]): WearPartGroup[] {
  const parts = consumablesOfKind(consumables, 'part')
  const active = fleet.filter((printer) => !printer.archived)
  const typeRank = (printType: PrintType) => PRINT_TYPES.indexOf(printType)
  const typeGroups = PRINT_TYPES.filter(
    (printType) =>
      printTypes.includes(printType) ||
      active.some((printer) => printer.printType === printType) ||
      parts.some((part) => part.printType === printType && fitsEveryPrinter(part)),
  ).map((printType) => ({
    printType,
    printers: active.filter((printer) => printer.printType === printType).length,
    parts: parts.filter((part) => part.printType === printType && fitsEveryPrinter(part)),
  }))
  const models = new Map<string, PrintType>()
  for (const printer of active) if (printer.presetId) models.set(printer.presetId, printer.printType)
  const modelGroups = [...models]
    .map(([printerPresetId, printType]) => ({
      printType,
      printerPresetId,
      printers: active.filter((printer) => printer.presetId === printerPresetId).length,
      parts: parts.filter((part) => part.printerId === undefined && part.printerPresetId === printerPresetId),
    }))
    .sort((a, b) => typeRank(a.printType) - typeRank(b.printType) || a.printerPresetId.localeCompare(b.printerPresetId))
  // A printer that took a catalogue model keeps the parts it had as a custom printer, in its own group.
  const custom = active.filter((printer) => !printer.presetId || parts.some((part) => part.printerId === printer.id))
  const customGroups = custom
    .map((printer) => ({
      printType: printer.printType,
      printerId: printer.id,
      printers: 1,
      parts: parts.filter((part) => part.printerId === printer.id),
    }))
    .sort((a, b) => typeRank(a.printType) - typeRank(b.printType))
  const leftModels = [
    ...new Set(
      parts.flatMap(({ printerPresetId, printerId }) =>
        printerPresetId && printerId === undefined && !models.has(printerPresetId) ? [printerPresetId] : [],
      ),
    ),
  ].map((printerPresetId) => {
    const owned = parts.filter((part) => part.printerId === undefined && part.printerPresetId === printerPresetId)
    return { printType: owned[0].printType, printerPresetId, printers: 0, parts: owned }
  })
  const leftPrinters = [
    ...new Set(parts.flatMap(({ printerId }) => (printerId && !custom.some(({ id }) => id === printerId) ? [printerId] : []))),
  ].map((printerId) => {
    const owned = parts.filter((part) => part.printerId === printerId)
    return { printType: owned[0].printType, printerId, printers: 0, parts: owned }
  })
  return [...typeGroups, ...modelGroups, ...customGroups, ...leftModels, ...leftPrinters]
}

/** What a consumable is bought at: per litre of resin, per kilogram of filament, and per supply unit or part. */
export function consumablePrice(consumable: Consumable) {
  if (consumable.kind === 'resin') return consumable.pricePerLitre
  if (consumable.kind === 'filament') return consumable.pricePerKg
  return consumable.price
}

export function withConsumablePrice<Item extends Consumable>(consumable: Item, price: number): Item {
  if (consumable.kind === 'resin') return { ...consumable, pricePerLitre: price }
  if (consumable.kind === 'filament') return { ...consumable, pricePerKg: price }
  return { ...consumable, price }
}

export type MissingConsumableField = 'name' | 'price' | 'density' | 'lifespan'

/**
 * What a consumable still lacks before it can be stored, in the order its form asks. A price or amount not entered yet
 * is NaN; materials need a price above zero, while a supply or part may be free.
 */
export function missingConsumableFields(consumable: Consumable): MissingConsumableField[] {
  const price = consumablePrice(consumable)
  const material = consumable.kind === 'resin' || consumable.kind === 'filament'
  return [
    !consumable.name.trim() && ('name' as const),
    !(material ? price > 0 : price >= 0) && ('price' as const),
    consumable.kind === 'resin' && !(consumable.densityGramsPerMl > 0) && ('density' as const),
    consumable.kind === 'part' && !(consumable.lifespan > 0) && ('lifespan' as const),
  ].filter((field) => field !== false)
}

/** The unit a consumable is used and stocked in: resin by the millilitre, filament by the gram, parts by the item. */
export function consumableUnit(consumable: Consumable): SupplyUnit {
  if (consumable.kind === 'resin') return 'ml'
  if (consumable.kind === 'filament') return 'g'
  if (consumable.kind === 'part') return 'item'
  return consumable.unit
}

/** What one `consumableUnit` of it costs, from the price it is bought at. */
export function consumableUnitPrice(consumable: Consumable) {
  const price =
    consumable.kind === 'resin'
      ? consumable.pricePerLitre / 1_000
      : consumable.kind === 'filament'
        ? consumable.pricePerKg / 1_000
        : consumable.kind === 'supply' && consumable.unit !== 'item'
          ? consumable.price / 1_000
          : consumable.price
  return Number.isFinite(price) ? Math.max(0, price) : 0
}

export function partCostPerPlate(part: PartConsumable) {
  return part.lifespanUnit === 'plates' ? spread(part) : 0
}

export function partCostPerHour(part: PartConsumable) {
  return part.lifespanUnit === 'hours' ? spread(part) : 0
}

function spread(part: PartConsumable) {
  return part.lifespan > 0 && Number.isFinite(part.price) ? Math.max(0, part.price) / part.lifespan : 0
}
