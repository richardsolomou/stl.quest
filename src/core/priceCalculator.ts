import { DEFAULT_PRINTER_POWER_WATTS, equipmentPowerTotals } from './equipmentPresets'

export const PRICE_CALCULATOR_SETTING = 'price_calculator'

export type PriceCalculatorEquipmentSettings = {
  mode: 'preset' | 'custom'
  presetIds: string[]
  printPowerWatts: number
  washPowerWatts: number
  washMinutesPerPlate: number
  dryPowerWatts: number
  dryMinutesPerPlate: number
  curePowerWatts: number
  cureMinutesPerPlate: number
}

export type PriceCalculatorSettings = {
  printType: 'resin' | 'filament'
  resinPresetId?: string
  resinPricePerLitre: number
  resinDensityGramsPerMl: number
  filamentPricePerKg: number
  electricityCountryCode?: string
  electricityPricePerKwh: number
  resinEquipment: PriceCalculatorEquipmentSettings
  filamentEquipment: PriceCalculatorEquipmentSettings
  equipmentCostPerHour: number
  consumablesCostPerPlate: number
  labourCostPerHour: number
  failureAllowancePercent: number
  standardMarginPercent: number
}

export type PriceCalculatorJob = {
  materialAmount: number
  materialUnit: 'ml' | 'g'
  printHours: number
  plates: number
  handsOnMinutes: number
}

export const DEFAULT_PRICE_CALCULATOR_SETTINGS: PriceCalculatorSettings = {
  printType: 'resin',
  resinPricePerLitre: 50,
  resinDensityGramsPerMl: 1.1,
  filamentPricePerKg: 25,
  electricityPricePerKwh: 0.135,
  resinEquipment: {
    mode: 'preset',
    presetIds: [],
    printPowerWatts: DEFAULT_PRINTER_POWER_WATTS.resin,
    washPowerWatts: 50,
    washMinutesPerPlate: 5,
    dryPowerWatts: 0,
    dryMinutesPerPlate: 0,
    curePowerWatts: 50,
    cureMinutesPerPlate: 15,
  },
  filamentEquipment: {
    mode: 'preset',
    presetIds: [],
    printPowerWatts: DEFAULT_PRINTER_POWER_WATTS.filament,
    washPowerWatts: 0,
    washMinutesPerPlate: 0,
    dryPowerWatts: 0,
    dryMinutesPerPlate: 0,
    curePowerWatts: 0,
    cureMinutesPerPlate: 0,
  },
  equipmentCostPerHour: 1,
  consumablesCostPerPlate: 0.75,
  labourCostPerHour: 15,
  failureAllowancePercent: 10,
  standardMarginPercent: 25,
}

export function calculatePrintPrice(settings: PriceCalculatorSettings, job: PriceCalculatorJob) {
  const equipmentSettings = equipmentSettingsFor(settings)
  const materialAmount = nonNegative(job.materialAmount)
  const resinDensity = settings.resinDensityGramsPerMl > 0 ? settings.resinDensityGramsPerMl : 1
  const printHours = nonNegative(job.printHours)
  const plates = nonNegative(job.plates)
  const handsOnMinutes = nonNegative(job.handsOnMinutes)
  const materialMl = job.materialUnit === 'ml' ? materialAmount : materialAmount / resinDensity
  const materialGrams = materialMl * resinDensity
  const material =
    settings.printType === 'filament'
      ? (materialGrams / 1_000) * nonNegative(settings.filamentPricePerKg)
      : (materialMl / 1_000) * nonNegative(settings.resinPricePerLitre)
  const printElectricity =
    printHours * (nonNegative(equipmentSettings.printPowerWatts) / 1_000) * nonNegative(settings.electricityPricePerKwh)
  const washElectricity =
    settings.printType === 'resin'
      ? phaseElectricity(plates, equipmentSettings.washMinutesPerPlate, equipmentSettings.washPowerWatts, settings.electricityPricePerKwh)
      : 0
  const dryElectricity = phaseElectricity(
    plates,
    equipmentSettings.dryMinutesPerPlate,
    equipmentSettings.dryPowerWatts,
    settings.electricityPricePerKwh,
  )
  const cureElectricity =
    settings.printType === 'resin'
      ? phaseElectricity(plates, equipmentSettings.cureMinutesPerPlate, equipmentSettings.curePowerWatts, settings.electricityPricePerKwh)
      : 0
  const equipment = printHours * nonNegative(settings.equipmentCostPerHour)
  const consumables = plates * nonNegative(settings.consumablesCostPerPlate)
  const labour = (handsOnMinutes / 60) * nonNegative(settings.labourCostPerHour)
  const productionCost = material + printElectricity + washElectricity + dryElectricity + cureElectricity + equipment + consumables
  const failureAllowance = productionCost * (nonNegative(settings.failureAllowancePercent) / 100)
  const estimatedCost = productionCost + failureAllowance
  const standardCost = estimatedCost + labour
  const standardMargin = Math.min(nonNegative(settings.standardMarginPercent), 95) / 100
  return {
    materialMl,
    materialGrams,
    material,
    printElectricity,
    washElectricity,
    dryElectricity,
    cureElectricity,
    equipment,
    consumables,
    failureAllowance,
    labour,
    estimatedCost,
    costPrice: estimatedCost,
    standardPrice: standardCost / (1 - standardMargin),
  }
}

export type PriceCalculation = ReturnType<typeof calculatePrintPrice>

export function equipmentSettingsFor(settings: PriceCalculatorSettings, printType = settings.printType) {
  return printType === 'resin' ? settings.resinEquipment : settings.filamentEquipment
}

export function applyEquipmentPresets(settings: PriceCalculatorSettings, equipmentPresetIds: string[]): PriceCalculatorSettings {
  const power = equipmentPowerTotals(equipmentPresetIds)
  return updateEquipmentSettings(settings, {
    ...equipmentSettingsFor(settings),
    presetIds: equipmentPresetIds,
    printPowerWatts: power.printing,
    washPowerWatts: power.washing,
    dryPowerWatts: power.drying,
    curePowerWatts: power.curing,
  })
}

export function selectPriceCalculatorPrintType(
  settings: PriceCalculatorSettings,
  printType: PriceCalculatorSettings['printType'],
): PriceCalculatorSettings {
  return { ...settings, printType }
}

export function selectEquipmentMode(
  settings: PriceCalculatorSettings,
  mode: PriceCalculatorEquipmentSettings['mode'],
): PriceCalculatorSettings {
  const equipment = { ...equipmentSettingsFor(settings), mode }
  const next = updateEquipmentSettings(settings, equipment)
  if (mode === 'custom') return next
  if (equipment.presetIds.length) return applyEquipmentPresets(next, equipment.presetIds)
  return updateEquipmentSettings(next, {
    ...equipment,
    printPowerWatts: DEFAULT_PRINTER_POWER_WATTS[settings.printType],
    washPowerWatts: settings.printType === 'resin' ? 50 : 0,
    dryPowerWatts: 0,
    curePowerWatts: settings.printType === 'resin' ? 50 : 0,
  })
}

export function updateEquipmentSettings(
  settings: PriceCalculatorSettings,
  equipment: PriceCalculatorEquipmentSettings,
): PriceCalculatorSettings {
  return {
    ...settings,
    [settings.printType === 'resin' ? 'resinEquipment' : 'filamentEquipment']: equipment,
  }
}

function phaseElectricity(plates: number, minutesPerPlate: number, powerWatts: number, pricePerKwh: number) {
  return plates * (nonNegative(minutesPerPlate) / 60) * (nonNegative(powerWatts) / 1_000) * nonNegative(pricePerKwh)
}

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
