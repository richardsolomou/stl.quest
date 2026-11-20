import { describe, expect, it } from 'vitest'
import type { Consumable } from './consumables'
import { upgradeLegacyCosting } from './legacyCosting'
import type { PrinterProfile } from './types'

/** A calculator setup as v1.52 stored it, with the defaults it saved alongside whatever the workspace changed. */
function v152Settings(overrides: Record<string, unknown> = {}) {
  const equipment = (printPowerWatts: number) => ({
    mode: 'preset',
    presetIds: [],
    printPowerWatts,
    washPowerWatts: 50,
    washMinutesPerPlate: 5,
    dryPowerWatts: 0,
    dryMinutesPerPlate: 0,
    curePowerWatts: 50,
    cureMinutesPerPlate: 15,
    partIds: [],
  })
  return {
    currency: 'GBP',
    printType: 'resin',
    resinPricePerLitre: 50,
    resinDensityGramsPerMl: 1.1,
    filamentPricePerKg: 25,
    electricityPricePerKwh: 0.3,
    resinEquipment: equipment(100),
    filamentEquipment: equipment(200),
    equipmentCostPerHour: 1,
    consumablesCostPerPlate: 0.75,
    labourCostPerHour: 18,
    failureAllowancePercent: 12,
    standardMarginPercent: 30,
    printerCosts: {},
    ...overrides,
  }
}

const saturn: PrinterProfile = { id: 'saturn', name: 'Saturn', printType: 'resin', presetId: 'elegoo-saturn-4-ultra' }
const homemade: PrinterProfile = { id: 'homemade', name: 'Homemade', printType: 'resin' }
const mk4: PrinterProfile = { id: 'mk4', name: 'MK4', printType: 'filament' }

function upgrade(priceCalculator: Record<string, unknown>, printers: PrinterProfile[] = [], consumables: Consumable[] = []) {
  return upgradeLegacyCosting({ priceCalculator, printers, consumables })
}

describe('upgrading v1.52 costing settings', () => {
  it('leaves settings without legacy fields alone', () => {
    expect(upgrade({ currency: 'EUR', labourCostPerHour: 15 })).toBeUndefined()
  })

  it('keeps only the business rates in the calculator settings', () => {
    expect(upgrade(v152Settings())?.priceCalculator).toEqual({
      currency: 'GBP',
      electricityPricePerKwh: 0.3,
      labourCostPerHour: 18,
      failureAllowancePercent: 12,
      standardMarginPercent: 30,
    })
  })

  it('creates a resin from a changed resin price', () => {
    expect(upgrade(v152Settings({ resinPricePerLitre: 32, resinDensityGramsPerMl: 1.2 }))?.consumables).toEqual([
      { id: 'legacy-resin', kind: 'resin', name: 'Resin', pricePerLitre: 32, densityGramsPerMl: 1.2 },
    ])
  })

  it('creates a filament from a changed filament price', () => {
    expect(upgrade(v152Settings({ filamentPricePerKg: 19 }))?.consumables).toEqual([
      { id: 'legacy-filament', kind: 'filament', name: 'Filament', pricePerKg: 19 },
    ])
  })

  it('creates a material at the default price for a workspace with printers of its type', () => {
    expect(upgrade(v152Settings(), [mk4])?.consumables).toEqual([
      { id: 'legacy-filament', kind: 'filament', name: 'Filament', pricePerKg: 25 },
    ])
  })

  it('creates no material at default prices without printers of its type', () => {
    expect(upgrade(v152Settings())?.consumables).toEqual([])
  })

  it('creates no material when the setup priced from a library one', () => {
    const library: Consumable[] = [{ id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 40, densityGramsPerMl: 1.1 }]

    expect(upgrade(v152Settings({ resinPricePerLitre: 32, resinConsumableId: 'grey' }), [], library)?.consumables).toEqual(library)
  })

  it('creates no material the library already has at that price', () => {
    const library: Consumable[] = [{ id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 32, densityGramsPerMl: 1.2 }]

    expect(upgrade(v152Settings({ resinPricePerLitre: 32, resinDensityGramsPerMl: 1.2 }), [], library)?.consumables).toEqual(library)
  })

  it('puts the material the setup priced with ahead of the library ones', () => {
    const library: Consumable[] = [{ id: 'basic', kind: 'filament', name: 'Basic', pricePerKg: 25 }]
    const consumables = upgrade(v152Settings({ filamentPricePerKg: 13 }), [mk4], library)?.consumables ?? []

    expect(consumables.filter(({ kind }) => kind === 'filament').map(({ id }) => id)).toEqual(['legacy-filament', 'basic'])
  })

  it('puts the library material the setup linked first', () => {
    const library: Consumable[] = [
      { id: 'basic', kind: 'filament', name: 'Basic', pricePerKg: 25 },
      { id: 'linked', kind: 'filament', name: 'Linked', pricePerKg: 13 },
    ]
    const consumables = upgrade(v152Settings({ filamentConsumableId: 'linked' }), [mk4], library)?.consumables ?? []

    expect(consumables.map(({ id }) => id)).toEqual(['linked', 'basic'])
  })

  it('puts the library material at the setup price first', () => {
    const library: Consumable[] = [
      { id: 'clear', kind: 'resin', name: 'Clear', pricePerLitre: 40, densityGramsPerMl: 1.1 },
      { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 32, densityGramsPerMl: 1.2 },
    ]
    const consumables = upgrade(v152Settings({ resinPricePerLitre: 32, resinDensityGramsPerMl: 1.2 }), [], library)?.consumables ?? []

    expect(consumables.map(({ id }) => id)).toEqual(['grey', 'clear'])
  })

  it('puts first the material most of its printers priced with', () => {
    const library: Consumable[] = [
      { id: 'clear', kind: 'resin', name: 'Clear', pricePerLitre: 40, densityGramsPerMl: 1.1 },
      { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 50, densityGramsPerMl: 1.1 },
    ]
    const own = { resinConsumableId: 'grey', resinPricePerLitre: 50 }
    const consumables =
      upgrade(v152Settings({ resinPricePerLitre: 63, printerCosts: { saturn: own, homemade: own } }), [saturn, homemade], library)
        ?.consumables ?? []

    expect(consumables[0].id).toBe('grey')
  })

  it('names a material priced only on one printer after it', () => {
    const settings = v152Settings({ printerCosts: { saturn: { resinPricePerLitre: 80, resinDensityGramsPerMl: 1.1 } } })

    expect(upgrade(settings, [saturn])?.consumables).toContainEqual({
      id: 'legacy-resin-saturn',
      kind: 'resin',
      name: 'Resin · Saturn',
      pricePerLitre: 80,
      densityGramsPerMl: 1.1,
    })
  })

  it('moves a printer’s own wear rate onto its purchase price and lifespan', () => {
    const settings = v152Settings({ printerCosts: { saturn: { equipmentCostPerHour: 0.4 } } })

    expect(upgrade(settings, [saturn])?.printers[0]).toMatchObject({ purchasePrice: 400, lifespanHours: 1_000 })
  })

  it('moves a changed workspace wear rate onto every printer without its own', () => {
    expect(upgrade(v152Settings({ equipmentCostPerHour: 2 }), [saturn, mk4])?.printers.map(({ purchasePrice }) => purchasePrice)).toEqual([
      2_000, 2_000,
    ])
  })

  it('leaves wear unset at the default rate', () => {
    expect(upgrade(v152Settings(), [saturn])?.printers[0]).toEqual(saturn)
  })

  it('keeps a printer’s own purchase price and lifespan', () => {
    const owned = { ...saturn, purchasePrice: 300, lifespanHours: 4_000 }

    expect(upgrade(v152Settings({ equipmentCostPerHour: 2 }), [owned])?.printers[0]).toEqual(owned)
  })

  it('moves a custom printing power onto a printer without a catalogue model', () => {
    const settings = v152Settings({
      printerCosts: { homemade: { equipment: { ...v152Settings().resinEquipment, mode: 'custom', printPowerWatts: 72 } } },
    })

    expect(upgrade(settings, [homemade])?.printers[0].powerWatts).toBe(72)
  })

  it('leaves a catalogue printer’s power to its model', () => {
    const settings = v152Settings({ resinEquipment: { ...v152Settings().resinEquipment, mode: 'custom', printPowerWatts: 72 } })

    expect(upgrade(settings, [saturn])?.printers[0].powerWatts).toBeUndefined()
  })

  it('moves bolt-on modules onto the printers they priced', () => {
    const settings = v152Settings({
      resinEquipment: { ...v152Settings().resinEquipment, presetIds: ['elegoo-saturn-4-ultra', 'accessory-elegoo-mini-heater'] },
    })

    expect(upgrade(settings, [saturn])?.printers[0].addOnPresetIds).toEqual(['accessory-elegoo-mini-heater'])
  })

  it('upgrades only once', () => {
    const first = upgrade(v152Settings({ resinPricePerLitre: 32, equipmentCostPerHour: 2 }), [saturn])!

    expect(upgrade(first.priceCalculator, first.printers, first.consumables)).toBeUndefined()
  })
})
