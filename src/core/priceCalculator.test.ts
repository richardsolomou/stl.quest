import { describe, expect, it } from 'vitest'
import {
  applyEquipmentPresets,
  calculatePrintPrice,
  DEFAULT_PRICE_CALCULATOR_SETTINGS,
  equipmentSettingsFor,
  selectEquipmentMode,
  selectPriceCalculatorPrintType,
  updateEquipmentSettings,
} from './priceCalculator'

const settings = {
  ...DEFAULT_PRICE_CALCULATOR_SETTINGS,
  resinPricePerLitre: 70,
  resinDensityGramsPerMl: 1.25,
  electricityCountryCode: 'CY',
  electricityPricePerKwh: 0.2774,
  resinEquipment: {
    mode: 'preset' as const,
    presetIds: ['resin-heygears-reflex-rs-turbo', 'accessory-heygears-pulsing-release-module', 'postprocess-elegoo-mercury-plus-v3'],
    printPowerWatts: 205,
    washPowerWatts: 60,
    washMinutesPerPlate: 5,
    dryPowerWatts: 0,
    dryMinutesPerPlate: 0,
    curePowerWatts: 60,
    cureMinutesPerPlate: 15,
  },
  equipmentCostPerHour: 1.15,
  consumablesCostPerPlate: 0.5,
}

describe('print price calculator', () => {
  it('starts resin estimates with the resin printer fallback power', () => {
    expect(DEFAULT_PRICE_CALCULATOR_SETTINGS.resinEquipment.printPowerWatts).toBe(100)
  })

  it('itemizes a sliced resin job', () => {
    const result = calculatePrintPrice(settings, {
      materialAmount: 108.43,
      materialUnit: 'ml',
      printHours: 5,
      plates: 2,
      handsOnMinutes: 0,
    })

    expect(result.materialMl).toBe(108.43)
    expect(result.materialGrams).toBeCloseTo(135.5375)
    expect(result.material).toBeCloseTo(7.5901)
    expect(result.printElectricity).toBeCloseTo(0.284335, 6)
    expect(result.washElectricity).toBeCloseTo(0.002774, 6)
    expect(result.dryElectricity).toBe(0)
    expect(result.cureElectricity).toBeCloseTo(0.008322, 6)
    expect(result.equipment).toBe(5.75)
    expect(result.consumables).toBe(1)
    expect(result.costPrice).toBeCloseTo(16.0990841)
    expect(result.standardPrice).toBeCloseTo(21.4654455)
  })

  it('converts sliced grams using the configured resin density', () => {
    const result = calculatePrintPrice(settings, {
      materialAmount: 135.5375,
      materialUnit: 'g',
      printHours: 5,
      plates: 2,
      handsOnMinutes: 12,
    })

    expect(result.materialMl).toBeCloseTo(108.43)
  })

  it('prices FDM material by sliced filament weight without resin washing or curing', () => {
    const result = calculatePrintPrice(
      { ...settings, printType: 'filament', filamentPricePerKg: 25 },
      {
        materialAmount: 120,
        materialUnit: 'g',
        printHours: 2,
        plates: 1,
        handsOnMinutes: 0,
      },
    )

    expect(result.materialGrams).toBe(120)
    expect(result.material).toBe(3)
    expect(result.washElectricity).toBe(0)
    expect(result.dryElectricity).toBe(0)
    expect(result.cureElectricity).toBe(0)
  })

  it('includes optional filament drying electricity', () => {
    const result = calculatePrintPrice(
      {
        ...settings,
        printType: 'filament',
        filamentEquipment: { ...settings.filamentEquipment, dryPowerWatts: 145, dryMinutesPerPlate: 240 },
      },
      { materialAmount: 100, materialUnit: 'g', printHours: 1, plates: 1, handsOnMinutes: 0 },
    )

    expect(result.dryElectricity).toBeCloseTo(0.160892)
  })

  it('keeps labour out of the cost quote', () => {
    const result = calculatePrintPrice(settings, {
      materialAmount: 1,
      materialUnit: 'ml',
      printHours: 0,
      plates: 0,
      handsOnMinutes: 60,
    })

    expect(result.labour).toBe(15)
    expect(result.costPrice).toBeCloseTo(0.077)
    expect(result.standardPrice).toBeCloseTo(20.1026667)
  })

  it('applies equipment presets to the active print type', () => {
    const result = applyEquipmentPresets({ ...settings, printType: 'filament' }, [
      'filament-bambu-lab-p1s',
      'accessory-bambu-lab-ams-2-pro',
    ])

    expect(equipmentSettingsFor(result).presetIds).toEqual(['filament-bambu-lab-p1s', 'accessory-bambu-lab-ams-2-pro'])
    expect(result.resinEquipment).toEqual(settings.resinEquipment)
    expect(result.filamentEquipment).toMatchObject({
      printPowerWatts: 1000,
      washPowerWatts: 0,
      dryPowerWatts: 96,
      curePowerWatts: 0,
    })
  })

  it('restores each print type equipment selection when switching tabs', () => {
    const filament = selectPriceCalculatorPrintType(
      {
        ...settings,
        filamentEquipment: {
          ...settings.filamentEquipment,
          presetIds: ['filament-bambu-lab-p1s', 'accessory-bambu-lab-ams-2-pro'],
          printPowerWatts: 1000,
          dryPowerWatts: 96,
        },
      },
      'filament',
    )
    const resin = selectPriceCalculatorPrintType(filament, 'resin')

    expect(equipmentSettingsFor(filament)).toMatchObject({ printPowerWatts: 1000, dryPowerWatts: 96 })
    expect(equipmentSettingsFor(resin)).toMatchObject({ printPowerWatts: 205, washPowerWatts: 60, curePowerWatts: 60 })
  })

  it('preserves separate custom equipment values across print types', () => {
    const customFilament = updateEquipmentSettings(selectPriceCalculatorPrintType(settings, 'filament'), {
      ...settings.filamentEquipment,
      mode: 'custom',
      printPowerWatts: 321,
      dryPowerWatts: 45,
    })

    expect(equipmentSettingsFor(selectPriceCalculatorPrintType(customFilament, 'resin'))).toBe(settings.resinEquipment)
    expect(equipmentSettingsFor(selectPriceCalculatorPrintType(customFilament, 'filament'))).toMatchObject({
      mode: 'custom',
      printPowerWatts: 321,
      dryPowerWatts: 45,
    })
  })

  it('restores preset power after using custom equipment values', () => {
    const custom = updateEquipmentSettings(settings, {
      ...settings.resinEquipment,
      mode: 'custom',
      printPowerWatts: 321,
      washPowerWatts: 42,
    })

    expect(equipmentSettingsFor(selectEquipmentMode(custom, 'preset'))).toMatchObject({
      mode: 'preset',
      printPowerWatts: 205,
      washPowerWatts: 60,
      curePowerWatts: 60,
    })
  })
})
