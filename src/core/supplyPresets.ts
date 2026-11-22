import type { SupplyConsumable, SupplyUnit } from './consumables'
import { enteredUnitScale } from './stock'
import type { PrintType } from './types'

export const SUPPLY_CATEGORIES = [
  'wash-fluid',
  'gloves',
  'paper-towels',
  'filter-funnel',
  'plate-cleaner',
  'plate-adhesive',
  'desiccant',
  'lubricant',
] as const
export type SupplyCategory = (typeof SUPPLY_CATEGORIES)[number]

/** A catalogue supply; one with no `brand` is a generic product no printer maker sells, so it has no list price. */
export type SupplyPreset = {
  id: string
  brand?: string
  name: string
  category: SupplyCategory
  unit: SupplyUnit
  /** Absent when resin and filament printing both use it. */
  printType?: PrintType
  /** How much one pack holds, in `unit`. */
  packSize?: number
  /** The manufacturer's store price for one pack on the checked date. */
  listPrice?: { amount: number; currency: string; url: string; checked: string; note?: string }
  /** Equipment catalogue presets whose maker names this supply, as `usedBySource` shows. */
  usedBy: string[]
  usedBySource?: string
  note?: string
  source?: { id: string; url: string }
  /** The manufacturer's product photo, served from the app's own files. */
  image?: { src: string }
}

/** Catalogue supplies that suit a workspace printing these types. */
export function supplyPresetsFor(supplies: readonly SupplyPreset[], printTypes: readonly PrintType[]) {
  return supplies.filter((preset) => !preset.printType || printTypes.includes(preset.printType))
}

/** Catalogue supplies the makers of these equipment models name, in catalogue order. */
export function supplyPresetsForEquipment(supplies: readonly SupplyPreset[], equipmentPresetIds: readonly (string | undefined)[]) {
  return supplies.filter((preset) => preset.usedBy.some((id) => equipmentPresetIds.includes(id)))
}

/** A library supply from the catalogue, with no price: the list price is only a hint for the user's own. */
export function supplyFromPreset(id: string, preset: SupplyPreset): SupplyConsumable {
  return {
    id,
    kind: 'supply',
    name: preset.brand ? `${preset.brand} ${preset.name}` : preset.name,
    unit: preset.unit,
    price: 0,
    supplyPresetId: preset.id,
    ...(preset.packSize && { packSize: preset.packSize }),
  }
}

/** The list price per litre, kilogram, or item, as a supply is priced, rounded to cents. */
export function supplyPresetUnitPrice(preset: SupplyPreset) {
  if (!preset.listPrice) return undefined
  const scale = enteredUnitScale(preset.unit)
  return Math.round((preset.listPrice.amount / ((preset.packSize ?? scale) / scale)) * 100) / 100
}
