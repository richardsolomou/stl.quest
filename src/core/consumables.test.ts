import { describe, expect, it } from 'vitest'
import { consumablesOfKind, partCostPerHour, partCostPerPlate, wearPartsFor, type Consumable } from './consumables'

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
})
