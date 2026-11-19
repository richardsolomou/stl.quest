import { describe, expect, it } from 'vitest'
import {
  applyEquipmentPresets,
  calculatePrintPrice,
  DEFAULT_PRICE_CALCULATOR_SETTINGS,
  equipmentSettingsFor,
  priceRequest,
  priceRequestOnPrinters,
  printerCostSettings,
  prunePrinterCosts,
  removePrinterCosts,
  startPrinterCosts,
  withPrinterCostSettings,
  selectEquipmentMode,
  selectPriceCalculatorCurrency,
  selectPriceCalculatorPrintType,
  updateEquipmentSettings,
  withConsumables,
} from './priceCalculator'
import type { Consumable } from './consumables'

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
    partIds: [],
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
    expect(result.estimatedCost).toBeCloseTo(16.0990841)
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
    expect(result.estimatedCost).toBeCloseTo(0.077)
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

  it('drops the euro electricity preset for another currency without converting any amount', () => {
    const pounds = selectPriceCalculatorCurrency(settings, 'GBP')

    expect(pounds).toEqual({ ...settings, currency: 'GBP', electricityCountryCode: undefined })
    expect(selectPriceCalculatorCurrency(pounds, 'EUR')).toMatchObject({ currency: 'EUR', electricityPricePerKwh: 0.2774 })
    expect(selectPriceCalculatorCurrency(settings, 'EUR')).toEqual(settings)
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

  it('prices a request as one job covering every copy', () => {
    const quote = priceRequest(settings, { printType: 'resin', material: 10, materialUnit: 'ml', minutes: 90, quantity: 3 })

    expect(quote?.job).toEqual({ materialAmount: 30, materialUnit: 'ml', printHours: 4.5, plates: 3, handsOnMinutes: 0 })
  })

  it('scales plate costs with the number of copies', () => {
    const request = { printType: 'resin' as const, material: 10, materialUnit: 'ml' as const, minutes: 90 }
    const one = priceRequest(settings, { ...request, quantity: 1 })!.result
    const three = priceRequest(settings, { ...request, quantity: 3 })!.result

    expect([three.consumables, three.washElectricity, three.cureElectricity]).toEqual([
      one.consumables * 3,
      one.washElectricity * 3,
      one.cureElectricity * 3,
    ])
  })

  it('prices a request with the setup for its own print type', () => {
    const quote = priceRequest(settings, { printType: 'filament', material: 120, materialUnit: 'g', minutes: 120, quantity: 1 })

    expect(quote?.result.material).toBe(3)
  })

  it('does not price a request missing its material estimate', () => {
    expect(priceRequest(settings, { printType: 'resin', materialUnit: 'ml', minutes: 90, quantity: 1 })).toBeUndefined()
  })

  it('does not price a request missing its time estimate', () => {
    expect(priceRequest(settings, { printType: 'resin', material: 10, materialUnit: 'ml', quantity: 1 })).toBeUndefined()
  })
})

describe('per-printer costs', () => {
  const saturn = { id: 'saturn', name: 'Saturn', printType: 'resin' as const, presetId: 'resin-elegoo-saturn-4-ultra' }
  const form4 = { id: 'form4', name: 'Form 4', printType: 'resin' as const, presetId: 'resin-formlabs-form-4' }
  const bambu = { id: 'bambu', name: 'P1S', printType: 'filament' as const }
  const withForm4 = withPrinterCostSettings(settings, 'form4', { ...printerCostSettings(settings, form4), resinPricePerLitre: 160 })

  it('uses the workspace setup for a printer without its own costs', () => {
    expect(printerCostSettings(settings, saturn).resinPricePerLitre).toBe(70)
  })

  it('uses the printer type of a printer without its own costs', () => {
    expect(printerCostSettings(settings, bambu).printType).toBe('filament')
  })

  it('uses a printer own material price', () => {
    expect(printerCostSettings(withForm4, form4).resinPricePerLitre).toBe(160)
  })

  it('keeps other printers on the workspace material price', () => {
    expect(printerCostSettings(withForm4, saturn).resinPricePerLitre).toBe(70)
  })

  it('leaves the workspace material price alone when editing a printer', () => {
    expect(withForm4.resinPricePerLitre).toBe(70)
  })

  it('shares labour edits made while a printer is selected', () => {
    const edited = withPrinterCostSettings(withForm4, 'form4', { ...printerCostSettings(withForm4, form4), labourCostPerHour: 30 })
    expect(printerCostSettings(edited, saturn).labourCostPerHour).toBe(30)
  })

  it('starts a printer own costs from its own rated power', () => {
    expect(printerCostSettings(startPrinterCosts(settings, saturn), saturn).resinEquipment.printPowerWatts).toBe(144 + 25)
  })

  it('keeps workspace accessories when starting a printer own costs', () => {
    expect(printerCostSettings(startPrinterCosts(settings, form4), form4).resinEquipment.presetIds).toContain(
      'postprocess-elegoo-mercury-plus-v3',
    )
  })

  it('returns a printer to the workspace setup when its own costs are removed', () => {
    expect(printerCostSettings(removePrinterCosts(withForm4, 'form4'), form4).resinPricePerLitre).toBe(70)
  })

  it('drops costs for printers that no longer exist', () => {
    expect(Object.keys(prunePrinterCosts(withForm4, [saturn]).printerCosts)).toEqual([])
  })

  it('keeps costs for printers that still exist', () => {
    expect(Object.keys(prunePrinterCosts(withForm4, [form4]).printerCosts)).toEqual(['form4'])
  })

  it('prices a request on every active printer of its print type', () => {
    const quotes = priceRequestOnPrinters(
      withForm4,
      [saturn, form4, bambu, { ...saturn, id: 'old', archived: true }],
      {
        printType: 'resin',
        material: 100,
        materialUnit: 'ml',
        minutes: 60,
        quantity: 1,
      },
      [],
    )
    expect(quotes.map(({ printer }) => printer.id)).toEqual(['saturn', 'form4'])
  })

  it('prices a request on each printer with that printer costs', () => {
    const quotes = priceRequestOnPrinters(
      withForm4,
      [saturn, form4],
      {
        printType: 'resin',
        material: 100,
        materialUnit: 'ml',
        minutes: 60,
        quantity: 1,
      },
      [],
    )
    expect(quotes.map(({ quote }) => quote?.result.material)).toEqual([7, 16])
  })
})

describe('consumables in quotes', () => {
  const library: Consumable[] = [
    { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 120, densityGramsPerMl: 1.2 },
    { id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 18 },
    { id: 'tank', kind: 'part', name: 'Tank', printType: 'resin', price: 60, lifespan: 200, lifespanUnit: 'plates' },
    { id: 'screen', kind: 'part', name: 'Screen', printType: 'resin', price: 120, lifespan: 2000, lifespanUnit: 'hours' },
  ]
  const withGrey = { ...settings, resinConsumableId: 'grey' }

  it('prices resin from the chosen consumable', () => {
    expect(withConsumables(withGrey, library).resinPricePerLitre).toBe(120)
  })

  it('uses the chosen resin density', () => {
    expect(withConsumables(withGrey, library).resinDensityGramsPerMl).toBe(1.2)
  })

  it('prices filament from the chosen consumable', () => {
    expect(withConsumables({ ...settings, filamentConsumableId: 'pla' }, library).filamentPricePerKg).toBe(18)
  })

  it('keeps the entered resin price when the chosen consumable no longer exists', () => {
    expect(withConsumables({ ...settings, resinConsumableId: 'gone' }, library).resinPricePerLitre).toBe(70)
  })

  it('adds plate-rated wear parts to the consumables per plate', () => {
    const parts = updateEquipmentSettings(settings, { ...settings.resinEquipment, partIds: ['tank'] })
    expect(withConsumables(parts, library).consumablesCostPerPlate).toBe(0.8)
  })

  it('adds hour-rated wear parts to the equipment wear per hour', () => {
    const parts = updateEquipmentSettings(settings, { ...settings.resinEquipment, partIds: ['screen'] })
    expect(withConsumables(parts, library).equipmentCostPerHour).toBeCloseTo(1.21)
  })

  it('compares printers with their consumables', () => {
    const form4 = { id: 'form4', printType: 'resin' as const }
    const own = withPrinterCostSettings(settings, 'form4', { ...printerCostSettings(settings, form4), resinConsumableId: 'grey' })
    const [quote] = priceRequestOnPrinters(
      own,
      [form4],
      { printType: 'resin', material: 100, materialUnit: 'ml', minutes: 60, quantity: 1 },
      library,
    )
    expect(quote?.quote?.result.material).toBe(12)
  })

  it('keeps a printer own resin when pricing it', () => {
    const form4 = { id: 'form4', printType: 'resin' as const }
    const own = withPrinterCostSettings(settings, 'form4', { ...printerCostSettings(settings, form4), resinConsumableId: 'grey' })
    expect(withConsumables(printerCostSettings(own, form4), library).resinPricePerLitre).toBe(120)
  })
})
