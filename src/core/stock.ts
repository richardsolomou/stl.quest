import { consumablesOfKind, wearPartsFor, type Consumable, type PartConsumable, type SupplyUnit } from './consumables'
import { genericPartPresets, partPresetsForPrinter, type PartCategory, type PartPreset } from './partPresets'
import { findPreset } from './presets'
import { PRINT_TYPES, type PrinterProfile, type PrintType } from './types'
import type { StockLevel } from './usage'

/** What one restock adds when the consumable names no pack size: a 1 L bottle of resin, a 1 kg spool, or one item. */
export function packSize(consumable: Consumable) {
  if (consumable.packSize) return consumable.packSize
  if (consumable.kind === 'resin' || consumable.kind === 'filament') return 1_000
  if (consumable.kind === 'part' || consumable.unit === 'item') return 1
  return undefined
}

/** How many consumables in use have never been stocked, counted, or given a minimum, so nothing checks whether they run low. */
export function untrackedConsumables(consumables: Consumable[], levels: StockLevel[]) {
  const tracked = new Set(levels.flatMap((level) => (level.tracked ? [level.consumableId] : [])))
  return consumables.filter((consumable) => !consumable.archived && !tracked.has(consumable.id)).length
}

/** A catalogue wear part a fleet's printers take that the library has nothing for. */
export type PartSuggestion = {
  preset: PartPreset
  printType: PrintType
  /** The fleet model it fits; absent for a generic part every printer of its print type uses. */
  printerPresetId?: string
  /** Active printers it would serve. */
  printers: number
}

/**
 * Catalogue wear parts the active fleet needs but the library lacks: each fleet model's own parts, then the generic
 * parts of each print type it prints. A part counts as had when the library holds one of the same kind for those
 * printers, from the catalogue or named like one, so a catalogue's alternatives (a smooth or a satin sheet) need only one.
 */
export function missingWearParts(consumables: Consumable[], fleet: PrinterProfile[], catalogue: readonly PartPreset[]): PartSuggestion[] {
  const active = fleet.filter((printer) => !printer.archived)
  const parts = consumablesOfKind(consumables, 'part')
  const models = new Map<string, PrintType>()
  for (const printer of active) if (printer.presetId) models.set(printer.presetId, printer.printType)
  const modelSuggestions = [...models].flatMap(([printerPresetId, printType]) => {
    const owned = wearPartsFor(consumables, printType, { presetId: printerPresetId })
    const printers = active.filter((printer) => printer.presetId === printerPresetId).length
    return lacking(partPresetsForPrinter(catalogue, printerPresetId), owned, catalogue).map((preset) => ({
      preset,
      printType,
      printerPresetId,
      printers,
    }))
  })
  const genericSuggestions = PRINT_TYPES.flatMap((printType) => {
    const printers = active.filter((printer) => printer.printType === printType).length
    if (!printers) return []
    const owned = parts.filter((part) => part.printType === printType)
    return lacking(genericPartPresets(catalogue, printType), owned, catalogue).map((preset) => ({ preset, printType, printers }))
  })
  return [...modelSuggestions, ...genericSuggestions]
}

/** Print types the active fleet prints with no material of that kind in the library. */
export function missingMaterials(consumables: Consumable[], fleet: PrinterProfile[]) {
  const active = fleet.filter((printer) => !printer.archived)
  return PRINT_TYPES.flatMap((printType) => {
    const printers = active.filter((printer) => printer.printType === printType).length
    return printers && !consumables.some((consumable) => consumable.kind === printType) ? [{ printType, printers }] : []
  })
}

/**
 * A library part from the catalogue, with no price: the catalogue's list price is only a hint for the user's own. It
 * belongs to the model it was suggested for, or to the custom printer it was added to.
 */
export function partFromPreset(
  id: string,
  suggestion: Pick<PartSuggestion, 'preset' | 'printerPresetId'> & { printerId?: string },
): PartConsumable {
  const { preset, printerPresetId, printerId } = suggestion
  const pack = preset.listPrice?.packSize
  return {
    id,
    kind: 'part',
    name: preset.name,
    printType: preset.printType,
    price: 0,
    lifespan: preset.lifespan,
    lifespanUnit: preset.lifespanUnit,
    partPresetId: preset.id,
    ...(printerPresetId && { printerPresetId }),
    ...(printerId && { printerId }),
    ...(pack && pack > 1 && { packSize: pack }),
  }
}

const CATEGORY_WORDS: [PartCategory, RegExp][] = [
  ['wash-solvent', /\b(ipa|isopropyl|alcohol|alcool|alkohol)|isopropanol/i],
  ['lcd-screen', /\b(lcd|screen|display|bildschirm)|écran/i],
  ['release-film', /\b(n?fep|pfa|acf|film|liner|release)|folie/i],
  ['resin-tank', /\b(tank|vat|cuve|bac)|wanne/i],
  ['nozzle', /\b(nozzle|hotend|buse)|düse/i],
  ['build-sheet', /\b(sheet|pei|plaque|plateau)|platte/i],
  ['air-filter', /filt(er|re)/i],
]

/** The kind of wear part a library part is: its catalogue part's, or else the one its name suggests. */
export function partCategory(part: PartConsumable, catalogue: readonly PartPreset[]): PartCategory | undefined {
  const preset = findPreset(catalogue, part.partPresetId)
  if (preset) return preset.category
  return CATEGORY_WORDS.find(([, words]) => words.test(part.name))?.[0]
}

function lacking(presets: PartPreset[], owned: PartConsumable[], catalogue: readonly PartPreset[]) {
  const had = new Set(owned.map((part) => partCategory(part, catalogue)))
  return presets.filter((preset) => !had.has(preset.category))
}

/** Stock is entered in litres, kilograms, or items, and kept in the consumable's own unit. */
export function enteredUnitScale(unit: SupplyUnit) {
  return unit === 'item' ? 1 : 1_000
}
