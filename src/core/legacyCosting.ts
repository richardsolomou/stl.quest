import { CONSUMABLES_SETTING, consumablesOfKind, type Consumable } from './consumables'
import { isPrinterAddOn } from './equipmentPresets'
import { PRICE_CALCULATOR_SETTING } from './priceCalculator'
import { PRINTERS_SETTING } from './printers'
import { PRINT_TYPES, type PrinterProfile, type PrintType } from './types'

/** What v1.51 and v1.52 kept per printer in the calculator settings, and the workspace-wide setup a printer without them used. */
type LegacyCosts = {
  resinConsumableId?: string
  filamentConsumableId?: string
  resinPricePerLitre?: number
  resinDensityGramsPerMl?: number
  filamentPricePerKg?: number
  equipmentCostPerHour?: number
  equipment?: LegacyEquipment
}
type LegacyEquipment = { mode?: 'preset' | 'custom'; presetIds?: string[]; printPowerWatts?: number }
type LegacySettings = LegacyCosts & {
  resinEquipment?: LegacyEquipment
  filamentEquipment?: LegacyEquipment
  printerCosts?: Record<string, LegacyCosts>
}

/** Every calculator field that moved onto consumables and printers or was dropped; any of them marks settings still to upgrade. */
const LEGACY_FIELDS = [
  'printType',
  'resinPresetId',
  'resinConsumableId',
  'filamentConsumableId',
  'resinPricePerLitre',
  'resinDensityGramsPerMl',
  'filamentPricePerKg',
  'resinEquipment',
  'filamentEquipment',
  'equipmentCostPerHour',
  'consumablesCostPerPlate',
  'printerCosts',
]

/** What the old calculator priced with until a workspace changed it, so an untouched default creates nothing. */
const LEGACY_DEFAULT_PRICES: Record<PrintType, number> = { resin: 50, filament: 25 }
const LEGACY_DEFAULT_WEAR_PER_HOUR = 1
const LEGACY_DEFAULT_RESIN_DENSITY = 1.1
/** A wear rate per print hour becomes a purchase price spread over this many hours, so the rate itself is kept exactly. */
const LEGACY_WEAR_LIFESPAN_HOURS = 1_000

type CostingSettings = { priceCalculator: Record<string, unknown>; printers: PrinterProfile[]; consumables: Consumable[] }

/**
 * Moves what v1.51 and v1.52 stored in the calculator settings to where costing lives now: material prices become
 * library resins and filaments, and each printer's wear rate, printing power, and bolt-on modules move onto the printer.
 * Returns undefined once nothing is left to move, so it runs once however often it is called.
 */
export function upgradeLegacyCosting({ priceCalculator, printers, consumables }: CostingSettings): CostingSettings | undefined {
  if (!LEGACY_FIELDS.some((field) => field in priceCalculator)) return undefined
  const legacy = priceCalculator as LegacySettings
  const costsOf = (printer: PrinterProfile) => legacy.printerCosts?.[printer.id]
  return {
    priceCalculator: Object.fromEntries(Object.entries(priceCalculator).filter(([field]) => !LEGACY_FIELDS.includes(field))),
    printers: printers.map((printer) => upgradePrinter(printer, legacy, costsOf(printer))),
    consumables: PRINT_TYPES.reduce(
      (library, printType) => library.concat(legacyMaterials(printType, legacy, printers, library)),
      consumables,
    ),
  }
}

/** The library resins or filaments the old prices call for: the workspace's own, then any a printer priced differently. */
function legacyMaterials(printType: PrintType, legacy: LegacySettings, printers: PrinterProfile[], library: Consumable[]): Consumable[] {
  const fleet = printers.filter((printer) => !printer.archived && printer.printType === printType)
  const priced = (costs: LegacyCosts) => {
    const linked = printType === 'resin' ? costs.resinConsumableId : costs.filamentConsumableId
    if (linked && consumablesOfKind(library, printType).some(({ id }) => id === linked)) return undefined
    const price = printType === 'resin' ? costs.resinPricePerLitre : costs.filamentPricePerKg
    return positive(price)
      ? { price, density: positive(costs.resinDensityGramsPerMl) ? costs.resinDensityGramsPerMl : undefined }
      : undefined
  }
  const shared = priced(legacy)
  const wanted = [
    ...(shared && (shared.price !== LEGACY_DEFAULT_PRICES[printType] || fleet.length > 0)
      ? [{ id: `legacy-${printType}`, name: materialName(printType), ...shared }]
      : []),
    ...fleet.flatMap((printer) => {
      const costs = legacy.printerCosts?.[printer.id]
      const own = costs && priced({ ...legacy, ...costs })
      return own ? [{ id: `legacy-${printType}-${printer.id}`, name: `${materialName(printType)} · ${printer.name}`, ...own }] : []
    }),
  ]
  const created: Consumable[] = []
  for (const { id, name, price, density } of wanted) {
    const material: Consumable =
      printType === 'resin'
        ? { id, kind: 'resin', name, pricePerLitre: price, densityGramsPerMl: density ?? LEGACY_DEFAULT_RESIN_DENSITY }
        : { id, kind: 'filament', name, pricePerKg: price }
    if (![...library, ...created].some((other) => other.id === id || samePrice(other, material))) created.push(material)
  }
  return created
}

function materialName(printType: PrintType) {
  return printType === 'resin' ? 'Resin' : 'Filament'
}

function samePrice(a: Consumable, b: Consumable) {
  if (a.kind === 'resin' && b.kind === 'resin') return a.pricePerLitre === b.pricePerLitre && a.densityGramsPerMl === b.densityGramsPerMl
  if (a.kind === 'filament' && b.kind === 'filament') return a.pricePerKg === b.pricePerKg
  return false
}

/** A printer with the wear rate, printing power, and bolt-on modules it was priced with, keeping anything it already has. */
function upgradePrinter(printer: PrinterProfile, legacy: LegacySettings, costs?: LegacyCosts): PrinterProfile {
  const equipment = costs?.equipment ?? (printer.printType === 'resin' ? legacy.resinEquipment : legacy.filamentEquipment)
  const wearPerHour = costs?.equipmentCostPerHour ?? legacy.equipmentCostPerHour
  const wear =
    positive(wearPerHour) && wearPerHour !== LEGACY_DEFAULT_WEAR_PER_HOUR && !printer.purchasePrice && !printer.lifespanHours
      ? { purchasePrice: Math.round(wearPerHour * LEGACY_WEAR_LIFESPAN_HOURS * 100) / 100, lifespanHours: LEGACY_WEAR_LIFESPAN_HOURS }
      : {}
  const power =
    equipment?.mode === 'custom' && !printer.presetId && printer.powerWatts === undefined && positive(equipment.printPowerWatts)
      ? { powerWatts: equipment.printPowerWatts }
      : {}
  const addOns =
    equipment?.mode !== 'custom'
      ? (equipment?.presetIds ?? []).filter((id) => isPrinterAddOn(id) && !printer.addOnPresetIds?.includes(id))
      : []
  return {
    ...printer,
    ...wear,
    ...power,
    ...(addOns.length && { addOnPresetIds: [...(printer.addOnPresetIds ?? []), ...addOns] }),
  }
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Upgrades one workspace's stored costing in a single write, touching only the settings it changes, so a workspace
 * that never saved printers or consumables keeps them unsaved. Returns whether anything was upgraded.
 */
export async function upgradeLegacyCostingSettings(repository: {
  getSetting<T>(key: string): Promise<T | undefined>
  setSettings(values: Record<string, unknown>): Promise<void>
}) {
  const priceCalculator = await repository.getSetting<Record<string, unknown>>(PRICE_CALCULATOR_SETTING)
  if (!priceCalculator) return false
  const printers = await repository.getSetting<PrinterProfile[]>(PRINTERS_SETTING)
  const consumables = await repository.getSetting<Consumable[]>(CONSUMABLES_SETTING)
  const upgraded = upgradeLegacyCosting({ priceCalculator, printers: printers ?? [], consumables: consumables ?? [] })
  if (!upgraded) return false
  const changed = (stored: unknown, next: unknown[]) => JSON.stringify(stored ?? []) !== JSON.stringify(next)
  await repository.setSettings({
    [PRICE_CALCULATOR_SETTING]: upgraded.priceCalculator,
    ...(changed(printers, upgraded.printers) && { [PRINTERS_SETTING]: upgraded.printers }),
    ...(changed(consumables, upgraded.consumables) && { [CONSUMABLES_SETTING]: upgraded.consumables }),
  })
  return true
}
