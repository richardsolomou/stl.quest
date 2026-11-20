import { describe, expect, it } from 'vitest'
import {
  consumablesOfKind,
  consumableUnit,
  consumableUnitPrice,
  partCostPerHour,
  partCostPerPlate,
  wearPartGroups,
  wearPartsFor,
  type Consumable,
} from './consumables'
import { workspacePrintTypes } from './printTypes'
import type { PrinterProfile } from './types'

const tank: Consumable = {
  id: 'tank',
  kind: 'part',
  name: 'Resin tank',
  printType: 'resin',
  price: 60,
  lifespan: 200,
  lifespanUnit: 'plates',
}
const screen: Consumable = {
  id: 'screen',
  kind: 'part',
  name: 'LCD',
  printType: 'resin',
  price: 120,
  lifespan: 2000,
  lifespanUnit: 'hours',
}
const nozzle: Consumable = {
  id: 'nozzle',
  kind: 'part',
  name: 'Nozzle',
  printType: 'filament',
  price: 10,
  lifespan: 500,
  lifespanUnit: 'hours',
}
const grey: Consumable = { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 50, densityGramsPerMl: 1.1 }
const pla: Consumable = { id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 20 }
const library = [tank, screen, nozzle, grey, pla]

describe('consumables', () => {
  it('spreads a plate-rated part over its plates', () => {
    expect(partCostPerPlate(tank)).toBe(0.3)
  })

  it('charges an hour-rated part nothing per plate', () => {
    expect(partCostPerPlate(screen)).toBe(0)
  })

  it('spreads an hour-rated part over its hours', () => {
    expect(partCostPerHour(screen)).toBe(0.06)
  })

  it('charges a part with no lifespan nothing', () => {
    expect(partCostPerPlate({ ...tank, lifespan: 0 })).toBe(0)
  })

  it('lists the materials of one kind', () => {
    expect(consumablesOfKind(library, 'resin').map(({ id }) => id)).toEqual(['grey'])
  })

  it('lists the wear parts for a print type', () => {
    expect(wearPartsFor(library, 'resin').map(({ id }) => id)).toEqual(['tank', 'screen'])
  })

  it('lists a model part for a printer of that model', () => {
    const owned = { ...tank, id: 'form4-tank', printerPresetId: 'form-4' }
    expect(wearPartsFor([owned, screen], 'resin', { presetId: 'form-4' }).map(({ id }) => id)).toEqual(['form4-tank', 'screen'])
  })

  it('leaves a model part off printers of other models', () => {
    const owned = { ...tank, id: 'form4-tank', printerPresetId: 'form-4' }
    expect(wearPartsFor([owned, screen], 'resin', { presetId: 'saturn-4' }).map(({ id }) => id)).toEqual(['screen'])
  })

  it('leaves model parts out of the print-type defaults', () => {
    const owned = { ...tank, id: 'form4-tank', printerPresetId: 'form-4' }
    expect(wearPartsFor([owned, screen], 'resin').map(({ id }) => id)).toEqual(['screen'])
  })

  it('applies a part still carrying a stored list of models to every printer of its print type', () => {
    const stored = { ...tank, printerPresetIds: ['form-4'] } as Consumable
    expect(wearPartsFor([stored], 'resin', { presetId: 'saturn-4' }).map(({ id }) => id)).toEqual(['tank'])
  })

  it('lists a custom printer’s own part for that printer', () => {
    const owned = { ...tank, id: 'vat', printerId: 'custom' }
    expect(wearPartsFor([owned, screen], 'resin', { id: 'custom' }).map(({ id }) => id)).toEqual(['vat', 'screen'])
  })

  it('leaves a custom printer’s own part off other printers', () => {
    const owned = { ...tank, id: 'vat', printerId: 'custom' }
    expect(wearPartsFor([owned, screen], 'resin', { id: 'other' }).map(({ id }) => id)).toEqual(['screen'])
  })

  it('leaves a custom printer’s own part out of the print-type defaults', () => {
    const owned = { ...tank, id: 'vat', printerId: 'custom' }
    expect(wearPartsFor([owned, screen], 'resin').map(({ id }) => id)).toEqual(['screen'])
  })
})

describe('wear part groups', () => {
  const printer = (id: string, presetId: string | undefined, printType: PrinterProfile['printType'] = 'resin'): PrinterProfile => ({
    id,
    name: id,
    printType,
    presetId,
  })
  const form4Tank = { ...tank, id: 'form4-tank', printerPresetId: 'form-4' }
  const fleet = [printer('a', 'form-4'), printer('b', 'form-4'), printer('c', undefined)]
  // The workspace prints what its fleet prints, as it does with print types left on automatic.
  const groups = (consumables: Consumable[], printers: PrinterProfile[]) =>
    wearPartGroups(consumables, printers, workspacePrintTypes('automatic', printers))
  const keys = (list: ReturnType<typeof wearPartGroups>) => list.map((group) => group.printerId ?? group.printerPresetId ?? group.printType)
  const customVat = { ...tank, id: 'vat', printerId: 'c' }

  it('lists the print types the fleet prints, then its models, then its custom printers', () => {
    expect(keys(groups([], fleet))).toEqual(['resin', 'form-4', 'c'])
  })

  it('gives a custom printer a group of its own', () => {
    expect(groups([], fleet).find((group) => group.printerId === 'c')).toMatchObject({ printType: 'resin', printers: 1 })
  })

  it('puts a custom printer’s own part in its group', () => {
    expect(
      groups([tank, customVat], fleet)
        .find((group) => group.printerId === 'c')
        ?.parts.map(({ id }) => id),
    ).toEqual(['vat'])
  })

  it('keeps a custom printer’s own part out of its print type group', () => {
    expect(groups([tank, customVat], fleet)[0].parts.map(({ id }) => id)).toEqual(['tank'])
  })

  it('keeps a custom printer that has left the fleet while it still has parts', () => {
    const archived = [printer('a', 'form-4'), { ...printer('c', undefined), archived: true }]
    expect(groups([customVat], archived).at(-1)).toMatchObject({ printerId: 'c', printers: 0 })
  })

  it('lists a model once however many printers share it', () => {
    expect(groups([], fleet).filter((group) => group.printerPresetId === 'form-4')).toHaveLength(1)
  })

  it('counts the printers of a model', () => {
    expect(groups([], fleet).find((group) => group.printerPresetId === 'form-4')?.printers).toBe(2)
  })

  it('counts every active printer of a print type, custom ones included', () => {
    expect(groups([], fleet)[0].printers).toBe(3)
  })

  it('leaves archived printers out', () => {
    expect(keys(groups([], [...fleet, { ...printer('d', 'saturn-4'), archived: true }]))).toEqual(['resin', 'form-4', 'c'])
  })

  it('puts parts with no model in their print type group', () => {
    expect(groups([tank, form4Tank], fleet)[0].parts.map(({ id }) => id)).toEqual(['tank'])
  })

  it('puts a model part in its model group', () => {
    expect(groups([tank, form4Tank], fleet)[1].parts.map(({ id }) => id)).toEqual(['form4-tank'])
  })

  it('keeps a print type group for parts the fleet no longer prints', () => {
    expect(keys(groups([nozzle], fleet))).toEqual(['resin', 'filament', 'form-4', 'c'])
  })

  it('keeps a model that has left the fleet while it still has parts', () => {
    expect(groups([form4Tank], [printer('c', undefined)]).at(-1)).toMatchObject({ printerPresetId: 'form-4', printers: 0 })
  })

  it('offers every print type before any printer is added', () => {
    expect(keys(groups([], []))).toEqual(['resin', 'filament'])
  })

  it('offers a print type the workspace prints without a printer of it yet', () => {
    expect(keys(wearPartGroups([], fleet, ['resin', 'filament']))).toEqual(['resin', 'filament', 'form-4', 'c'])
  })
})

describe('consumable units', () => {
  it('stocks resin by the millilitre', () => {
    expect(consumableUnit({ id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 50, densityGramsPerMl: 1.1 })).toBe('ml')
  })

  it('prices resin per millilitre from its price per litre', () => {
    expect(consumableUnitPrice({ id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 50, densityGramsPerMl: 1.1 })).toBe(0.05)
  })

  it('prices filament per gram from its price per kilogram', () => {
    expect(consumableUnitPrice({ id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 20 })).toBe(0.02)
  })

  it('prices a liquid supply per millilitre from its price per litre', () => {
    expect(consumableUnitPrice({ id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 10 })).toBe(0.01)
  })

  it('prices a counted supply per item', () => {
    expect(consumableUnitPrice({ id: 'gloves', kind: 'supply', name: 'Gloves', unit: 'item', price: 0.2 })).toBe(0.2)
  })

  it('prices a wear part per item', () => {
    expect(consumableUnitPrice(tank)).toBe(60)
  })
})
