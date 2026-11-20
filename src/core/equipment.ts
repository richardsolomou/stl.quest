import { consumableUnit, consumableUnitPrice, partCostPerHour, partCostPerPlate, type Consumable } from './consumables'
import type { PrintType } from './types'
import type { UsageUnit } from './usage'

export const EQUIPMENT_SETTING = 'equipment'
export const MAX_EQUIPMENT = 100

/** Where in the workflow a piece of equipment is used, and so which step asks for it. */
export const EQUIPMENT_STAGES = ['before-printing', 'finishing'] as const
export type EquipmentStage = (typeof EQUIPMENT_STAGES)[number]

export const EQUIPMENT_KINDS = ['wash', 'cure', 'wash-cure', 'oven', 'ultrasonic', 'dryer', 'other'] as const
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number]

/** A supply the equipment uses up each time it runs, such as IPA for a wash station; `amountPerUse` is in the consumable's stock unit (`consumableUnit`). */
export type EquipmentSupply = { consumableId: string; amountPerUse: number }

/**
 * Standalone kit the workspace owns and uses in its workflow, independent of any printer: wash and cure stations,
 * ovens, cleaners, filament dryers. Bolt-on printer modules are printer add-ons, not equipment.
 */
export type EquipmentItem = {
  id: string
  name: string
  /** A catalogue entry in catalogs/equipment; its name and power come from there. */
  presetId?: string
  kind: EquipmentKind
  stage: EquipmentStage
  /** The print type it serves, absent for both; read through `equipmentPrintType`, as most kinds decide it themselves. */
  printType?: PrintType
  powerWatts: number
  minutesPerUse: number
  supplies: EquipmentSupply[]
  /** For wear: what it cost and how many hours it lasts. */
  purchasePrice?: number
  lifespanHours?: number
  archived?: boolean
}

/** The print type a kind serves by its nature: washing and curing are for resin, drying for filament; other kinds may serve either. */
export function kindPrintType(kind: EquipmentKind): PrintType | undefined {
  if (kind === 'wash' || kind === 'cure' || kind === 'wash-cure') return 'resin'
  if (kind === 'dryer') return 'filament'
  return undefined
}

/** The print type an item serves, undefined for both: its kind's where the kind decides, otherwise its own setting. */
export function equipmentPrintType(item: Pick<EquipmentItem, 'kind' | 'printType'>) {
  return kindPrintType(item.kind) ?? item.printType
}

/** Whether a kind is any use to a workspace printing these types; a kind that serves one type needs that type. */
export function kindServesAny(kind: EquipmentKind, printTypes: readonly PrintType[]) {
  const served = kindPrintType(kind)
  return !served || printTypes.includes(served)
}

export function servesPrintType(item: Pick<EquipmentItem, 'kind' | 'printType'>, printType?: PrintType) {
  const served = equipmentPrintType(item)
  return !served || !printType || served === printType
}

export function equipmentForStage(items: EquipmentItem[], stage: EquipmentStage, printType?: PrintType) {
  return items.filter((item) => !item.archived && item.stage === stage && servesPrintType(item, printType))
}

/** A typical run when nothing else is known: a wash cycle, a cure, a combined cycle, or a filament drying session. */
export const DEFAULT_MINUTES_PER_USE: Record<EquipmentKind, number> = {
  wash: 10,
  cure: 15,
  'wash-cure': 25,
  oven: 60,
  ultrasonic: 10,
  dryer: 240,
  other: 15,
}

/** Dryers prepare filament before it prints; everything else post-processes finished prints. */
export function defaultEquipmentStage(kind: EquipmentKind): EquipmentStage {
  return kind === 'dryer' ? 'before-printing' : 'finishing'
}

/** The unit equipment uses a supply in: the consumable's own, except a wear part, which wears by the plate or print minute it lasts. */
export function supplyUnit(consumable: Consumable): Extract<UsageUnit, 'ml' | 'g' | 'item' | 'plate' | 'minute'> {
  if (consumable.kind !== 'part') return consumableUnit(consumable)
  return consumable.lifespanUnit === 'plates' ? 'plate' : 'minute'
}

/** What one `supplyUnit` of a consumable costs, so a quote and the usage it records price a supply the same way. */
export function supplyUnitPrice(consumable: Consumable) {
  if (consumable.kind !== 'part') return consumableUnitPrice(consumable)
  return consumable.lifespanUnit === 'plates' ? partCostPerPlate(consumable) : partCostPerHour(consumable) / 60
}

/** Supplies whose consumable is no longer in the library; they stay stored so restoring the consumable restores them. */
export function missingSupplies(item: EquipmentItem, consumables: Consumable[]) {
  const ids = new Set(consumables.map((consumable) => consumable.id))
  return item.supplies.filter((supply) => !ids.has(supply.consumableId))
}
