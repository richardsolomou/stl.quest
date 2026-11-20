import {
  consumablesOfKind,
  partCostPerHour,
  partCostPerPlate,
  wearPartsFor,
  type Consumable,
  type FilamentConsumable,
  type ResinConsumable,
} from './consumables'
import { supplyUnitPrice, type EquipmentItem } from './equipment'
import { printingPower } from './equipmentPresets'
import type { PrinterProfile, PrintType } from './types'

export const PRICE_CALCULATOR_SETTING = 'price_calculator'

/** Display currencies only: changing the currency never converts the amounts a workspace entered. */
export const PRICE_CALCULATOR_CURRENCIES = [
  'EUR',
  'USD',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'ISK',
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'JPY',
  'CNY',
  'HKD',
  'SGD',
  'KRW',
  'INR',
  'BRL',
  'MXN',
  'ZAR',
  'ILS',
  'TRY',
] as const

export type PriceCalculatorCurrency = (typeof PRICE_CALCULATOR_CURRENCIES)[number]

/** The country electricity presets are sourced in euros, so other currencies enter their own tariff. */
export function electricityPresetsAvailable(currency: PriceCalculatorCurrency) {
  return currency === 'EUR'
}

/** Business rates only: what a printer, material, or piece of equipment costs lives on that thing, not here. */
export type PriceCalculatorSettings = {
  currency: PriceCalculatorCurrency
  electricityCountryCode?: string
  electricityPricePerKwh: number
  labourCostPerHour: number
  failureAllowancePercent: number
  /** Added on top of what a print costs to make, labour included, so 50 prices a €10 print at €15. */
  markupPercent: number
}

/** The highest value each business rate accepts; every rate is at least zero. */
export const PRICE_CALCULATOR_MAXIMUMS = {
  electricityPricePerKwh: 1_000,
  labourCostPerHour: 100_000,
  failureAllowancePercent: 100,
  markupPercent: 2_000,
} as const

/** The share of the price a markup keeps as profit, as a percentage: a 50% markup keeps a third of each sale. */
export function profitSharePercent(markupPercent: number) {
  const markup = nonNegative(markupPercent)
  return (markup / (100 + markup)) * 100
}

/** Whether every rate is a number from zero to its maximum, as storing them requires. */
export function validPriceCalculatorSettings(settings: PriceCalculatorSettings) {
  return (Object.keys(PRICE_CALCULATOR_MAXIMUMS) as (keyof typeof PRICE_CALCULATOR_MAXIMUMS)[]).every(
    (key) => Number.isFinite(settings[key]) && settings[key] >= 0 && settings[key] <= PRICE_CALCULATOR_MAXIMUMS[key],
  )
}

export const DEFAULT_PRICE_CALCULATOR_SETTINGS: PriceCalculatorSettings = {
  currency: 'EUR',
  electricityPricePerKwh: 0.135,
  labourCostPerHour: 15,
  failureAllowancePercent: 10,
  markupPercent: 50,
}

/** Stand-ins for a material nobody picked, so a rough quote always appears; the breakdown marks them as typical. */
export const TYPICAL_RESIN_PRICE_PER_LITRE = 50
export const TYPICAL_RESIN_DENSITY_GRAMS_PER_ML = 1.1
export const TYPICAL_FILAMENT_PRICE_PER_KG = 25

/**
 * A printer without its own purchase price wears like a typical hobby machine: about 600 spread over 3,000 print hours,
 * a common calculator default and the cautious end of the 2,000 to 10,000 hours makers and guides give.
 */
export const TYPICAL_PRINTER_PURCHASE_PRICE = 600
export const TYPICAL_PRINTER_LIFESPAN_HOURS = 3_000

/** A resin print is washed and cured even when no equipment is picked, so a typical station stands in for it. */
export const TYPICAL_RESIN_FINISHING: EquipmentItem = {
  id: 'typical-wash-cure',
  name: '',
  kind: 'wash-cure',
  stage: 'finishing',
  printType: 'resin',
  powerWatts: 50,
  minutesPerUse: 20,
  supplies: [],
}

export type PriceCalculatorJob = {
  materialAmount: number
  materialUnit: 'ml' | 'g'
  printHours: number
  plates: number
  handsOnMinutes: number
}

export type CostedPrinter = Pick<
  PrinterProfile,
  'id' | 'printType' | 'presetId' | 'purchasePrice' | 'lifespanHours' | 'addOnPresetIds' | 'powerWatts'
>

export type PrintCostInput = {
  rates: PriceCalculatorSettings
  printType: PrintType
  job: PriceCalculatorJob
  /** The workspace library, for wear parts and the supplies equipment uses. */
  consumables: Consumable[]
  printer?: CostedPrinter
  material?: ResinConsumable | FilamentConsumable
  /** Each is used once per plate; none for a resin print means a typical wash and cure. */
  equipment?: EquipmentItem[]
}

export type EquipmentCost = {
  item: EquipmentItem
  typical: boolean
  electricity: number
  supplies: number
  wear: number
}

/**
 * Itemises a print's cost from what it uses: material, the printer's power and wear, its model's wear parts, and each
 * piece of equipment once per plate. Failure allowance applies to production, never to labour; the markup to both.
 */
export function costPrint({ rates, printType, job, consumables, printer, material, equipment = [] }: PrintCostInput) {
  const pricePerKwh = nonNegative(rates.electricityPricePerKwh)
  const printHours = nonNegative(job.printHours)
  const plates = nonNegative(job.plates)
  const resin = material?.kind === 'resin' ? material : undefined
  const filament = material?.kind === 'filament' ? material : undefined
  const density = positive(resin?.densityGramsPerMl) ?? TYPICAL_RESIN_DENSITY_GRAMS_PER_ML
  const materialAmount = nonNegative(job.materialAmount)
  const materialMl = job.materialUnit === 'ml' ? materialAmount : materialAmount / density
  const materialGrams = materialMl * density
  const materialCost =
    printType === 'filament'
      ? (materialGrams / 1_000) * nonNegative(filament?.pricePerKg ?? TYPICAL_FILAMENT_PRICE_PER_KG)
      : (materialMl / 1_000) * nonNegative(resin?.pricePerLitre ?? TYPICAL_RESIN_PRICE_PER_LITRE)
  const power = printingPower(printType, printer?.presetId, printer?.addOnPresetIds, printer?.powerWatts)
  const printElectricity = printHours * electricityPerHour(power.watts, pricePerKwh)
  const machineWear = printerWear(printer)
  const printerWearCost = printHours * machineWear.perHour
  const wearParts = wearPartsFor(consumables, printType, printer).map((part) => ({
    part,
    cost: plates * partCostPerPlate(part) + printHours * partCostPerHour(part),
  }))
  const typicalFinishing = printType === 'resin' && !equipment.length
  const equipmentCosts: EquipmentCost[] = (typicalFinishing ? [TYPICAL_RESIN_FINISHING] : equipment).map((item) => {
    const hours = (plates * nonNegative(item.minutesPerUse)) / 60
    return {
      item,
      typical: typicalFinishing,
      electricity: hours * electricityPerHour(item.powerWatts, pricePerKwh),
      supplies:
        plates * sum(item.supplies.map((supply) => nonNegative(supply.amountPerUse) * suppliedPrice(consumables, supply.consumableId))),
      wear: hours * wearPerHour(item.purchasePrice, item.lifespanHours),
    }
  })
  const production =
    materialCost +
    printElectricity +
    printerWearCost +
    sum(wearParts.map(({ cost }) => cost)) +
    sum(equipmentCosts.map(({ electricity, supplies, wear }) => electricity + supplies + wear))
  const failureAllowance = production * (nonNegative(rates.failureAllowancePercent) / 100)
  const estimatedCost = production + failureAllowance
  const labour = (nonNegative(job.handsOnMinutes) / 60) * nonNegative(rates.labourCostPerHour)
  const markup = (estimatedCost + labour) * (nonNegative(rates.markupPercent) / 100)
  return {
    materialMl,
    materialGrams,
    material: { cost: materialCost, typical: !material },
    printing: {
      watts: power.watts,
      typical: power.typical,
      electricity: printElectricity,
      wear: printerWearCost,
      wearTypical: machineWear.typical,
    },
    wearParts,
    equipment: equipmentCosts,
    failureAllowance,
    estimatedCost,
    labour,
    markup,
    suggestedPrice: estimatedCost + labour + markup,
  }
}

export type PrintCost = ReturnType<typeof costPrint>

/**
 * A quote in whole minor units of its currency, as the breakdown lists it: each line rounded so the lines add up to the
 * rounded cost to make, and the markup to the rounded price, which stays what the unrounded quote rounds to.
 */
export function roundQuote(cost: PrintCost, currency: PriceCalculatorCurrency) {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  const lines = [
    cost.material.cost,
    cost.printing.electricity,
    cost.printing.wear,
    ...cost.wearParts.map(({ cost: part }) => part),
    ...cost.equipment.flatMap(({ electricity, supplies, wear }) => [electricity, supplies, wear]),
    cost.failureAllowance,
    cost.labour,
  ]
  const rounded = roundToTotal(lines, digits)
  const costToMake = roundTo(sum(rounded), digits)
  const suggestedPrice = roundTo(cost.suggestedPrice, digits)
  let line = 0
  const next = () => rounded[line++]
  return {
    ...cost,
    material: { ...cost.material, cost: next() },
    printing: { ...cost.printing, electricity: next(), wear: next() },
    wearParts: cost.wearParts.map((part) => ({ ...part, cost: next() })),
    equipment: cost.equipment.map((item) => ({ ...item, electricity: next(), supplies: next(), wear: next() })),
    failureAllowance: next(),
    labour: next(),
    estimatedCost: roundTo(costToMake - rounded[rounded.length - 1], digits),
    costToMake,
    markup: roundTo(suggestedPrice - costToMake, digits),
    suggestedPrice,
  }
}

/** Rounds each value to `digits` places so they sum to their rounded total, nudging the ones that lost most to rounding. */
function roundToTotal(values: number[], digits: number) {
  const scale = 10 ** digits
  // Drops floating-point noise first, so 299.99999999 minor units counts as 300 rather than 299 plus a remainder.
  const units = values.map((value) => Math.round(value * scale * 1e6) / 1e6)
  const floors = units.map(Math.floor)
  let shortfall = Math.round(sum(units)) - sum(floors)
  const byRemainder = units.map((unit, index) => ({ index, remainder: unit - floors[index] })).sort((a, b) => b.remainder - a.remainder)
  for (const { index } of byRemainder) {
    if (shortfall <= 0) break
    floors[index] += 1
    shortfall -= 1
  }
  return floors.map((unit) => unit / scale)
}

function roundTo(value: number, digits: number) {
  const scale = 10 ** digits
  return Math.round(Math.round(value * scale * 1e6) / 1e6) / scale
}

/** A representative job of each print type, so the quote can show its breakdown before the slicer totals are in. */
export const TYPICAL_JOBS: Record<PrintType, PriceCalculatorJob> = {
  resin: { materialAmount: 60, materialUnit: 'ml', printHours: 4, plates: 1, handsOnMinutes: 15 },
  filament: { materialAmount: 120, materialUnit: 'g', printHours: 6, plates: 1, handsOnMinutes: 10 },
}

/**
 * What the picks cost per print hour, per plate, and per ml of resin or g of filament, before failure allowance, labour,
 * and margin. Each rate is `costPrint` on a one-unit job, so a quote's production cost is exactly their weighted sum.
 */
export function costBasis(input: Omit<PrintCostInput, 'job'>) {
  const unit: PriceCalculatorJob['materialUnit'] = input.printType === 'resin' ? 'ml' : 'g'
  const per = (job: Partial<PriceCalculatorJob>) =>
    costPrint({ ...input, job: { materialAmount: 0, materialUnit: unit, printHours: 0, plates: 0, handsOnMinutes: 0, ...job } })
  const hour = per({ printHours: 1 })
  const plate = per({ plates: 1 })
  const { material } = per({ materialAmount: 1 })
  const packSize = positive(input.material?.packSize)
  return {
    hour: { ...hour.printing, parts: hour.wearParts.filter(({ cost }) => cost > 0), total: productionCost(hour) },
    plate: { parts: plate.wearParts.filter(({ cost }) => cost > 0), equipment: plate.equipment, total: productionCost(plate) },
    material: { ...material, unit, pack: packSize === undefined ? undefined : { size: packSize, cost: packSize * material.cost } },
  }
}

export type CostBasis = ReturnType<typeof costBasis>

function productionCost(cost: PrintCost) {
  return cost.estimatedCost - cost.failureAllowance
}

/** What a printer costs per print minute at the workspace's electricity rate: its printing power and its wear. */
export function printerCostPerMinute(rates: Pick<PriceCalculatorSettings, 'electricityPricePerKwh'>, printer: CostedPrinter) {
  const { watts } = printingPower(printer.printType, printer.presetId, printer.addOnPresetIds, printer.powerWatts)
  return (electricityPerHour(watts, rates.electricityPricePerKwh) + printerWear(printer).perHour) / 60
}

/** What a piece of equipment costs per minute it runs at the workspace's electricity rate: its power and its wear. */
export function equipmentCostPerMinute(rates: Pick<PriceCalculatorSettings, 'electricityPricePerKwh'>, item: EquipmentItem) {
  return (electricityPerHour(item.powerWatts, rates.electricityPricePerKwh) + wearPerHour(item.purchasePrice, item.lifespanHours)) / 60
}

export function selectPriceCalculatorCurrency(
  settings: PriceCalculatorSettings,
  currency: PriceCalculatorCurrency,
): PriceCalculatorSettings {
  if (electricityPresetsAvailable(currency)) return { ...settings, currency }
  return { ...settings, currency, electricityCountryCode: undefined }
}

export type RequestPriceInput = {
  printType: PrintType
  material?: number
  materialUnit: PriceCalculatorJob['materialUnit']
  minutes?: number
  quantity: number
}

/**
 * Prices every copy on its own plate with no hands-on time, on the printer given and the material the calculator offers
 * first; a partial estimate prices nothing rather than understating it.
 */
export function priceRequest(
  { rates, consumables, printer }: Pick<PrintCostInput, 'rates' | 'consumables' | 'printer'>,
  request: RequestPriceInput,
) {
  if (request.material === undefined || request.minutes === undefined) return undefined
  const job: PriceCalculatorJob = {
    materialAmount: request.material * request.quantity,
    materialUnit: request.materialUnit,
    printHours: (request.minutes * request.quantity) / 60,
    plates: request.quantity,
    handsOnMinutes: 0,
  }
  const material = consumablesOfKind(consumables, request.printType)[0]
  return { job, result: costPrint({ rates, printType: request.printType, job, consumables, printer, material }) }
}

/** Prices a request on each active printer of its print type, so the operator can compare where to run it. */
export function priceRequestOnPrinters<Printer extends CostedPrinter & Pick<PrinterProfile, 'archived'>>(
  rates: PriceCalculatorSettings,
  printers: Printer[],
  request: RequestPriceInput,
  consumables: Consumable[],
) {
  return printers
    .filter((printer) => !printer.archived && printer.printType === request.printType)
    .map((printer) => ({ printer, quote: priceRequest({ rates, consumables, printer }, request) }))
}

function suppliedPrice(consumables: Consumable[], consumableId: string) {
  const consumable = consumables.find(({ id }) => id === consumableId)
  return consumable ? supplyUnitPrice(consumable) : 0
}

function electricityPerHour(watts: number, pricePerKwh: number) {
  return (nonNegative(watts) / 1_000) * nonNegative(pricePerKwh)
}

/** What a printer wears per print hour: its own price over its lifespan or a typical one, else a typical printer's wear. */
export function printerWear(printer?: Pick<CostedPrinter, 'purchasePrice' | 'lifespanHours'>) {
  const price = positive(printer?.purchasePrice)
  const hours = positive(printer?.lifespanHours)
  if (price === undefined) return { perHour: TYPICAL_PRINTER_PURCHASE_PRICE / TYPICAL_PRINTER_LIFESPAN_HOURS, typical: true }
  return { perHour: price / (hours ?? TYPICAL_PRINTER_LIFESPAN_HOURS), typical: hours === undefined }
}

function wearPerHour(purchasePrice?: number, lifespanHours?: number) {
  const price = positive(purchasePrice)
  const hours = positive(lifespanHours)
  return price && hours ? price / hours : 0
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function positive(value?: number) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
