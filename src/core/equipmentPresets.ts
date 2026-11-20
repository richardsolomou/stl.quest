import catalog from '../../catalogs/equipment/catalog.json'
import images from '../../catalogs/equipment/images.json'
import { DEFAULT_MINUTES_PER_USE, defaultEquipmentStage, kindPrintType, type EquipmentItem, type EquipmentKind } from './equipment'
import { getPrinterPreset, type PrinterPreset } from './printerPresets'

export type EquipmentPhase = 'printing' | 'washing' | 'drying' | 'curing'
/** `basis` cites where the figure comes from; a profile without one is STL Quest's own default estimate. */
export type EquipmentPowerProfile = { phase: EquipmentPhase; watts: number; basis?: string }
export type EquipmentPreset = Omit<(typeof catalog.presets)[number], 'powerProfiles' | 'printType'> & {
  printType?: 'resin' | 'filament'
  powerProfiles: EquipmentPowerProfile[]
  image?: { src: string }
}

const IMAGE_SOURCES = new Map(images.images.map(({ presetId, src }) => [presetId, src]))

export const EQUIPMENT_PRESETS = catalog.presets.map((preset) => {
  const src = IMAGE_SOURCES.get(preset.id)
  return src ? { ...preset, image: { src } } : preset
}) as EquipmentPreset[]

export const DEFAULT_PRINTER_POWER_WATTS = { resin: 100, filament: 200 } as const

export function getEquipmentPreset(id: string) {
  return EQUIPMENT_PRESETS.find((preset) => preset.id === id)
}

export function printerPowerProfile(id: string): EquipmentPowerProfile | undefined {
  const printer = getPrinterPreset(id)
  if (!printer) return undefined
  return (
    matchingPrinterPowerPreset(printer)?.powerProfiles.find((profile) => profile.phase === 'printing') ?? {
      phase: 'printing',
      watts: DEFAULT_PRINTER_POWER_WATTS[printer.printType],
    }
  )
}

/** Bolt-on modules that run while printing, such as a pulsing release module or an AMS, kept on the printers that have them. */
export const PRINTER_ADD_ON_PRESETS = EQUIPMENT_PRESETS.filter(
  (preset) => !preset.id.startsWith('printer-') && preset.powerProfiles.some(({ phase }) => phase === 'printing'),
)

export function isPrinterAddOn(id: string) {
  return PRINTER_ADD_ON_PRESETS.some((preset) => preset.id === id)
}

/**
 * What a printer draws while printing: its catalogue model's power, or else the power the user gave it, plus its
 * add-ons' printing power. With neither, the print type's typical power stands in, and `typical` says so.
 */
export function printingPower(printType: 'resin' | 'filament', printerPresetId?: string, addOnPresetIds: string[] = [], ownWatts?: number) {
  const catalogue = printerPresetId ? printerPowerProfile(printerPresetId) : undefined
  const model = catalogue ?? (ownWatts !== undefined && ownWatts > 0 ? { watts: ownWatts } : undefined)
  const addOns = addOnPresetIds.reduce(
    (total, id) => total + (getEquipmentPreset(id)?.powerProfiles.find(({ phase }) => phase === 'printing')?.watts ?? 0),
    0,
  )
  return { watts: (model?.watts ?? DEFAULT_PRINTER_POWER_WATTS[printType]) + addOns, typical: !model }
}

function matchingPrinterPowerPreset(printer: PrinterPreset) {
  const identity = normalizeIdentity(`${printer.brand} ${printer.model}`)
  return EQUIPMENT_PRESETS.find(
    (preset) => preset.id.startsWith('printer-') && normalizeIdentity(`${preset.brand} ${preset.model}`) === identity,
  )
}

function normalizeIdentity(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')
}

const STANDALONE_PHASES = ['washing', 'drying', 'curing'] as const satisfies EquipmentPhase[]

/**
 * Catalogue entries that stand on their own in the workflow: wash, cure, and drying stations. Printers and anything that
 * draws power while printing, such as heaters, purifiers, and AMS units, belong to a printer instead.
 */
export const STANDALONE_EQUIPMENT_PRESETS = EQUIPMENT_PRESETS.filter(
  (preset) =>
    !preset.id.startsWith('printer-') &&
    preset.powerProfiles.every((profile) => profile.phase !== 'printing') &&
    preset.powerProfiles.some((profile) => (STANDALONE_PHASES as readonly string[]).includes(profile.phase)),
)

export function equipmentPresetName(preset: EquipmentPreset) {
  return `${preset.brand} ${preset.model}`
}

/** What a catalogue entry does, read from the phases it has power for. */
export function equipmentPresetKind(preset: EquipmentPreset): EquipmentKind {
  const has = (phase: EquipmentPhase) => preset.powerProfiles.some((profile) => profile.phase === phase)
  if (has('washing')) return has('curing') ? 'wash-cure' : 'wash'
  if (has('curing')) return 'cure'
  return 'dryer'
}

/** One machine runs one phase at a time, so its draw is the highest phase's. */
export function equipmentPresetWatts(preset: EquipmentPreset) {
  return Math.max(...preset.powerProfiles.map((profile) => profile.watts))
}

export function equipmentFromPreset(id: string, preset: EquipmentPreset): EquipmentItem {
  const kind = equipmentPresetKind(preset)
  return {
    id,
    name: equipmentPresetName(preset),
    presetId: preset.id,
    kind,
    stage: defaultEquipmentStage(kind),
    printType: preset.printType ?? kindPrintType(kind) ?? 'resin',
    powerWatts: equipmentPresetWatts(preset),
    minutesPerUse: DEFAULT_MINUTES_PER_USE[kind],
    supplies: [],
  }
}
