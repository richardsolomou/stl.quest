import catalog from '../../equipment-catalog/catalog.json'
import { getPrinterPreset, type PrinterPreset } from './printerPresets'

export type EquipmentPhase = 'printing' | 'washing' | 'drying' | 'curing'
export type EquipmentPowerProfile = { phase: EquipmentPhase; watts: number; basis: string }
export type EquipmentPreset = Omit<(typeof catalog.presets)[number], 'powerProfiles' | 'printType'> & {
  printType?: 'resin' | 'filament'
  powerProfiles: EquipmentPowerProfile[]
}

export const EQUIPMENT_PRESETS = catalog.presets as EquipmentPreset[]

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
      basis: 'default estimate; enter measured power in Custom mode for a closer quote',
    }
  )
}

export function equipmentPowerTotals(ids: string[]) {
  return ids.reduce(
    (totals, id) => {
      const printerProfile = printerPowerProfile(id)
      const profiles = getEquipmentPreset(id)?.powerProfiles ?? (printerProfile ? [printerProfile] : [])
      for (const profile of profiles) totals[profile.phase] += profile.watts
      return totals
    },
    { printing: 0, washing: 0, drying: 0, curing: 0 },
  )
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
