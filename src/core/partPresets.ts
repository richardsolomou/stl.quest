import type { PrintType } from './types'

export const PART_CATEGORIES = [
  'resin-tank',
  'release-film',
  'lcd-screen',
  'lcd-protector',
  'flex-platform',
  'nozzle',
  'build-sheet',
  'air-filter',
  'belt',
  'purge-wiper',
  'wiping-pad',
  'cutter',
  'ptfe-tube',
  // Never catalogued; it keeps a library part named like IPA from reading as another kind.
  'wash-solvent',
] as const
export type PartCategory = (typeof PART_CATEGORIES)[number]

/** `stated` is the manufacturer's own figure, `derived` converts its layer count to plates, and `typical` is STL Quest's labelled estimate. */
export type PartLifespanBasis = 'stated' | 'derived' | 'typical'

export type PartPreset = {
  id: string
  brand: string
  name: string
  category: PartCategory
  /** Set when a model needs this part alongside others of its category, such as separate X and Y belts, so owning one does not stand in for the others. */
  set?: string
  printType: PrintType
  /** Printer preset IDs the part is made for; empty for a generic part that suits every printer of its print type. */
  fits: string[]
  lifespan: number
  lifespanUnit: 'plates' | 'hours'
  lifespanSource: { basis: PartLifespanBasis; url?: string; note: string; statedLayers?: number }
  /** The manufacturer's store price for one pack on the checked date. */
  listPrice?: { amount: number; currency: string; packSize?: number; url: string; checked: string; note?: string }
  source: { id: string; url: string }
  /** The manufacturer's product photo, served from the app's own files. */
  image?: { src: string }
}

export function partPresetsForPrinter(parts: readonly PartPreset[], printerPresetId: string) {
  return parts.filter((preset) => preset.fits.includes(printerPresetId))
}

/** The catalogue parts a wear-part group can add: its model's own, or those every printer of its type takes. */
export function partPresetsForGroup(parts: readonly PartPreset[], group: { printType: PrintType; printerPresetId?: string }) {
  return group.printerPresetId ? partPresetsForPrinter(parts, group.printerPresetId) : genericPartPresets(parts, group.printType)
}

export function genericPartPresets(parts: readonly PartPreset[], printType: PrintType) {
  return parts.filter((preset) => preset.printType === printType && !preset.fits.length)
}

/** The list price of one part, rounded to cents, when the catalogue has one. */
export function partPresetUnitPrice(preset: PartPreset) {
  if (!preset.listPrice) return undefined
  return Math.round((preset.listPrice.amount / (preset.listPrice.packSize ?? 1)) * 100) / 100
}

/** Catalogue parts one wear-part group can take, kept with the printer model a part chosen from them belongs to. */
export type PartPresetChoice = { printerPresetId?: string; presets: PartPreset[] }

/**
 * What adding a part to a group offers: a model's own parts, or for a print type or custom printer the generic parts
 * of its type. A print type also offers each fleet model's own, so a part added from there joins that model's group.
 */
export function partPresetChoices(
  parts: readonly PartPreset[],
  group: { printType: PrintType; printerPresetId?: string; printerId?: string },
  fleetModels: readonly { printType: PrintType; printerPresetId: string }[],
): PartPresetChoice[] {
  const choices: PartPresetChoice[] = [{ printerPresetId: group.printerPresetId, presets: partPresetsForGroup(parts, group) }]
  if (group.printerPresetId === undefined && group.printerId === undefined)
    for (const model of fleetModels)
      if (model.printType === group.printType)
        choices.push({ printerPresetId: model.printerPresetId, presets: partPresetsForPrinter(parts, model.printerPresetId) })
  return choices.filter(({ presets }) => presets.length)
}
