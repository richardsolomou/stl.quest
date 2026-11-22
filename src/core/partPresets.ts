import type { PrintType } from './types'

export type PartCategory = 'resin-tank' | 'release-film' | 'lcd-screen' | 'nozzle' | 'build-sheet' | 'air-filter' | 'wash-solvent'

/** `stated` is the manufacturer's own figure, `derived` converts its layer count to plates, and `typical` is STL Quest's labelled estimate. */
export type PartLifespanBasis = 'stated' | 'derived' | 'typical'

export type PartPreset = {
  id: string
  brand: string
  name: string
  category: PartCategory
  printType: PrintType
  /** Printer preset IDs the part is made for; empty for a generic part that suits every printer of its print type. */
  fits: string[]
  lifespan: number
  lifespanUnit: 'plates' | 'hours'
  lifespanSource: { basis: PartLifespanBasis; url?: string; note: string; statedLayers?: number }
  /** The manufacturer's store price for one pack on the checked date. */
  listPrice?: { amount: number; currency: string; packSize?: number; url: string; checked: string; note?: string }
  source: { id: string; url: string }
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
