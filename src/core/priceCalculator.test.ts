import { describe, expect, it } from 'vitest'
import type { Consumable, FilamentConsumable, ResinConsumable } from './consumables'
import type { EquipmentItem } from './equipment'
import {
  costBasis,
  costPrint,
  DEFAULT_PRICE_CALCULATOR_SETTINGS,
  priceRequest,
  priceRequestOnPrinters,
  profitSharePercent,
  printerCostPerMinute,
  roundQuote,
  selectPriceCalculatorCurrency,
  validPriceCalculatorSettings,
  type PriceCalculatorJob,
  type PrintCostInput,
} from './priceCalculator'

const rates = { ...DEFAULT_PRICE_CALCULATOR_SETTINGS, electricityPricePerKwh: 0.2, failureAllowancePercent: 10, markupPercent: 25 }
const job: PriceCalculatorJob = { materialAmount: 100, materialUnit: 'ml', printHours: 10, plates: 2, handsOnMinutes: 0 }
const grey: ResinConsumable = { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 120, densityGramsPerMl: 1.2 }
const pla: FilamentConsumable = { id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 18 }
const library: Consumable[] = [
  grey,
  pla,
  { id: 'tank', kind: 'part', name: 'Tank', printType: 'resin', price: 60, lifespan: 200, lifespanUnit: 'plates' },
  { id: 'screen', kind: 'part', name: 'Screen', printType: 'resin', price: 120, lifespan: 2000, lifespanUnit: 'hours' },
  {
    id: 'form4-tank',
    kind: 'part',
    name: 'Form 4 tank',
    printType: 'resin',
    price: 100,
    lifespan: 100,
    lifespanUnit: 'plates',
    printerPresetId: 'resin-formlabs-form-4',
  },
  { id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 10 },
]
const wash: EquipmentItem = {
  id: 'wash',
  name: 'Wash',
  kind: 'wash',
  stage: 'finishing',
  printType: 'resin',
  powerWatts: 120,
  minutesPerUse: 30,
  supplies: [{ consumableId: 'ipa', amountPerUse: 50 }],
  purchasePrice: 300,
  lifespanHours: 1000,
}
const reflex = {
  id: 'reflex',
  printType: 'resin' as const,
  presetId: 'resin-heygears-reflex-rs-turbo',
  addOnPresetIds: ['accessory-heygears-pulsing-release-module'],
  purchasePrice: 2000,
  lifespanHours: 10_000,
}

function cost(input: Partial<PrintCostInput> = {}) {
  return costPrint({ rates, printType: 'resin', job, consumables: [], ...input })
}

describe('material cost', () => {
  it('prices resin from the picked consumable', () => {
    expect(cost({ material: grey }).material.cost).toBe(12)
  })

  it('prices resin at a typical price when none is picked', () => {
    expect(cost().material.cost).toBe(5)
  })

  it('marks a material nobody picked as typical', () => {
    expect(cost().material.typical).toBe(true)
  })

  it('converts sliced grams with the picked resin density', () => {
    expect(cost({ material: grey, job: { ...job, materialAmount: 120, materialUnit: 'g' } }).materialMl).toBeCloseTo(100)
  })

  it('prices filament by sliced weight', () => {
    expect(
      cost({ printType: 'filament', material: pla, job: { ...job, materialAmount: 200, materialUnit: 'g' } }).material.cost,
    ).toBeCloseTo(3.6)
  })

  it('prices filament at a typical price when none is picked', () => {
    expect(cost({ printType: 'filament', job: { ...job, materialAmount: 200, materialUnit: 'g' } }).material.cost).toBeCloseTo(5)
  })
})

describe('printing cost', () => {
  it('adds an add-on module to the printer model power', () => {
    expect(cost({ printer: reflex }).printing.watts).toBe(205)
  })

  it('prices printing electricity by hours and power', () => {
    expect(cost({ printer: reflex }).printing.electricity).toBeCloseTo(0.41)
  })

  it('uses typical power without a printer', () => {
    expect(cost().printing).toMatchObject({ watts: 100, typical: true })
  })

  it('uses the printing power given to a custom printer', () => {
    expect(cost({ printer: { id: 'rig', printType: 'resin', powerWatts: 300 } }).printing).toMatchObject({ watts: 300, typical: false })
  })

  it('spreads the printer price across its lifespan hours', () => {
    expect(cost({ printer: reflex }).printing.wear).toBeCloseTo(2)
  })

  it('marks the printer wear from its own price and lifespan as not typical', () => {
    expect(cost({ printer: reflex }).printing.wearTypical).toBe(false)
  })

  it('spreads a printer price without a lifespan over a typical lifespan', () => {
    expect(cost({ printer: { ...reflex, lifespanHours: undefined } }).printing).toMatchObject({
      wear: (2000 / 3000) * 10,
      wearTypical: true,
    })
  })

  it('counts typical wear for a printer without a purchase price', () => {
    expect(cost({ printer: { ...reflex, purchasePrice: undefined } }).printing).toMatchObject({ wear: 2, wearTypical: true })
  })

  it('counts typical wear without a printer', () => {
    expect(cost().printing).toMatchObject({ wear: 2, wearTypical: true })
  })

  it('costs a plate-rated wear part by plate', () => {
    expect(cost({ consumables: library }).wearParts.find(({ part }) => part.id === 'tank')?.cost).toBeCloseTo(0.6)
  })

  it('costs an hour-rated wear part by print hour', () => {
    expect(cost({ consumables: library }).wearParts.find(({ part }) => part.id === 'screen')?.cost).toBeCloseTo(0.6)
  })

  it('adds a model wear part on a printer of that model', () => {
    expect(
      cost({ consumables: library, printer: { id: 'form4', printType: 'resin', presetId: 'resin-formlabs-form-4' } }).wearParts.map(
        ({ part }) => part.id,
      ),
    ).toEqual(['tank', 'screen', 'form4-tank'])
  })

  it('leaves a model wear part off other printers', () => {
    expect(cost({ consumables: library, printer: reflex }).wearParts.map(({ part }) => part.id)).toEqual(['tank', 'screen'])
  })
})

describe('equipment cost', () => {
  it('prices equipment electricity once per plate', () => {
    expect(cost({ equipment: [wash] }).equipment[0].electricity).toBeCloseTo(0.024)
  })

  it('prices supplies from the library by the unit used', () => {
    expect(cost({ equipment: [wash], consumables: library }).equipment[0].supplies).toBeCloseTo(1)
  })

  it('prices a wear part used as a supply by the plate', () => {
    const basket: Consumable = {
      id: 'basket',
      kind: 'part',
      name: 'Basket',
      printType: 'resin',
      price: 20,
      lifespan: 500,
      lifespanUnit: 'plates',
    }
    const item = { ...wash, supplies: [{ consumableId: 'basket', amountPerUse: 1 }] }
    expect(cost({ equipment: [item], consumables: [basket] }).equipment[0].supplies).toBeCloseTo(0.08)
  })

  it('prices a supply missing from the library at nothing', () => {
    expect(cost({ equipment: [wash] }).equipment[0].supplies).toBe(0)
  })

  it('spreads the equipment price across its running hours', () => {
    expect(cost({ equipment: [wash] }).equipment[0].wear).toBeCloseTo(0.3)
  })

  it('stands in a typical wash and cure for a resin print without equipment', () => {
    expect(cost().equipment[0].typical).toBe(true)
  })

  it('stands in nothing for a filament print without equipment', () => {
    expect(cost({ printType: 'filament' }).equipment).toEqual([])
  })
})

describe('quote totals', () => {
  const materialOnly = { ...job, printHours: 0, plates: 0 }

  it('adds the failure allowance to production', () => {
    expect(cost({ material: grey, job: materialOnly }).failureAllowance).toBeCloseTo(1.2)
  })

  it('keeps labour out of the estimated cost', () => {
    expect(cost({ material: grey, job: { ...materialOnly, handsOnMinutes: 60 } }).estimatedCost).toBeCloseTo(13.2)
  })

  it('prices labour by the hour', () => {
    expect(cost({ job: { ...materialOnly, handsOnMinutes: 30 } }).labour).toBe(7.5)
  })

  it('marks up cost and labour', () => {
    expect(cost({ material: grey, job: { ...materialOnly, handsOnMinutes: 60 } }).suggestedPrice).toBeCloseTo(35.25)
  })

  it('doubles the cost at a 100% markup', () => {
    expect(cost({ material: grey, job: materialOnly, rates: { ...rates, markupPercent: 100 } }).suggestedPrice).toBeCloseTo(26.4)
  })
})

describe('profit share', () => {
  it('keeps a third of the price at a 50% markup', () => {
    expect(profitSharePercent(50)).toBeCloseTo(33.333)
  })

  it('keeps nothing without a markup', () => {
    expect(profitSharePercent(0)).toBe(0)
  })
})

describe('rounded quote', () => {
  // 120 g of typical filament for 6 hours at 411 W: lines of 3, 0.333, 1.2, 0.453, and 2.5 that each round down.
  const filamentJob: PriceCalculatorJob = { materialAmount: 120, materialUnit: 'g', printHours: 6, plates: 1, handsOnMinutes: 10 }
  const quote = (markupPercent = 33.33, currency: PrintCostInput['rates']['currency'] = 'EUR') =>
    roundQuote(
      costPrint({
        rates: { ...DEFAULT_PRICE_CALCULATOR_SETTINGS, currency, markupPercent },
        printType: 'filament',
        job: filamentJob,
        consumables: [],
        printer: { id: 'mk4', printType: 'filament', powerWatts: 411 },
      }),
      currency,
    )
  const lines = (rounded: ReturnType<typeof quote>) => [
    rounded.material.cost,
    rounded.printing.electricity,
    rounded.printing.wear,
    rounded.failureAllowance,
    rounded.labour,
  ]
  const total = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100

  it('lists lines that add up to the rounded cost to make', () => {
    expect(total(lines(quote()))).toBe(7.49)
  })

  it('totals the cost to make from its lines', () => {
    const rounded = quote()
    expect(total(lines(rounded))).toBe(rounded.costToMake)
  })

  it('adds the markup to the cost to make for the price', () => {
    const rounded = quote()
    expect(total([rounded.costToMake, rounded.markup])).toBe(rounded.suggestedPrice)
  })

  it('keeps the price the unrounded quote rounds to', () => {
    expect(quote().suggestedPrice).toBe(9.98)
  })

  it('rounds to whole units in a currency without minor units', () => {
    expect(lines(quote(33.33, 'JPY')).every(Number.isInteger)).toBe(true)
  })
})

describe('cost basis', () => {
  const basis = (input: Partial<PrintCostInput> = {}) => costBasis({ rates, printType: 'resin', consumables: library, ...input })

  it('prices a print hour as the printer power, its wear, and its hourly parts', () => {
    expect(basis({ printer: reflex }).hour.total).toBeCloseTo(0.301)
  })

  it('lists only the parts that wear by the hour per print hour', () => {
    expect(basis().hour.parts.map(({ part }) => part.id)).toEqual(['screen'])
  })

  it('prices a plate as its plate-rated parts and one use of each piece of equipment', () => {
    expect(basis({ equipment: [wash] }).plate.total).toBeCloseTo(0.962)
  })

  it('lists only the parts that wear by the plate per plate', () => {
    expect(basis().plate.parts.map(({ part }) => part.id)).toEqual(['tank'])
  })

  it('stands in a typical wash and cure on a resin plate without equipment', () => {
    expect(basis().plate.equipment[0].typical).toBe(true)
  })

  it('prices resin per millilitre', () => {
    expect(basis({ material: grey }).material).toMatchObject({ unit: 'ml', cost: 0.12, typical: false })
  })

  it('prices filament per gram', () => {
    expect(basis({ printType: 'filament', material: pla }).material.cost).toBeCloseTo(0.018)
  })

  it('marks a material nobody picked as typical', () => {
    expect(basis().material.typical).toBe(true)
  })

  it('prices a whole pack from the pack size', () => {
    expect(basis({ material: { ...grey, packSize: 500 } }).material.pack).toEqual({ size: 500, cost: 60 })
  })

  it('prices no pack without a pack size', () => {
    expect(basis({ material: grey }).material.pack).toBeUndefined()
  })

  it('weights to the production cost of a quote', () => {
    const input = { material: grey, printer: reflex, equipment: [wash] }
    const { hour, plate, material } = basis(input)
    const quote = cost({ ...input, consumables: library })
    expect(job.printHours * hour.total + job.plates * plate.total + job.materialAmount * material.cost).toBeCloseTo(
      quote.estimatedCost - quote.failureAllowance,
    )
  })
})

describe('printer cost per minute', () => {
  it('uses the printing power given to a custom printer', () => {
    const perHour =
      printerCostPerMinute(rates, { id: 'rig', printType: 'resin', powerWatts: 300, purchasePrice: 600, lifespanHours: 600 }) * 60
    expect(perHour).toBeCloseTo(1.06)
  })

  it('counts typical wear for a printer without a purchase price', () => {
    expect(printerCostPerMinute({ electricityPricePerKwh: 0 }, { id: 'rig', printType: 'resin' }) * 60).toBeCloseTo(0.2)
  })
})

describe('request quotes', () => {
  const request = { printType: 'resin' as const, material: 50, materialUnit: 'ml' as const, minutes: 90, quantity: 2 }

  it('prices every copy on its own plate', () => {
    expect(priceRequest({ rates, consumables: [] }, request)?.job).toEqual({
      materialAmount: 100,
      materialUnit: 'ml',
      printHours: 3,
      plates: 2,
      handsOnMinutes: 0,
    })
  })

  it('prices a request in the first library material of its print type', () => {
    expect(priceRequest({ rates, consumables: library }, request)?.result.material).toEqual({ cost: 12, typical: false })
  })

  it('prices a typical material when the library has none of its print type', () => {
    expect(priceRequest({ rates, consumables: [pla] }, request)?.result.material).toEqual({ cost: 5, typical: true })
  })

  it('does not price a request missing its material estimate', () => {
    expect(priceRequest({ rates, consumables: [] }, { ...request, material: undefined })).toBeUndefined()
  })

  it('does not price a request missing its time estimate', () => {
    expect(priceRequest({ rates, consumables: [] }, { ...request, minutes: undefined })).toBeUndefined()
  })

  it('compares the active printers of the request print type', () => {
    const printers = [reflex, { ...reflex, id: 'old', archived: true }, { id: 'p1s', printType: 'filament' as const }]
    expect(priceRequestOnPrinters(rates, printers, request, []).map(({ printer }) => printer.id)).toEqual(['reflex'])
  })
})

describe('currency', () => {
  it('drops the euro electricity preset for another currency without converting', () => {
    expect(selectPriceCalculatorCurrency({ ...rates, electricityCountryCode: 'CY' }, 'USD')).toEqual({ ...rates, currency: 'USD' })
  })
})

describe('rate limits', () => {
  it('accepts the default rates', () => {
    expect(validPriceCalculatorSettings(DEFAULT_PRICE_CALCULATOR_SETTINGS)).toBe(true)
  })

  it('rejects a markup above its maximum', () => {
    expect(validPriceCalculatorSettings({ ...DEFAULT_PRICE_CALCULATOR_SETTINGS, markupPercent: 2_001 })).toBe(false)
  })

  it('rejects a negative rate', () => {
    expect(validPriceCalculatorSettings({ ...DEFAULT_PRICE_CALCULATOR_SETTINGS, labourCostPerHour: -1 })).toBe(false)
  })
})
