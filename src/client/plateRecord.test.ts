import { describe, expect, it } from 'vitest'
import type { Consumable } from '../core/consumables'
import type { SlicedPlate } from '../core/slicedPlate'
import { measuredRecord, slicedObjectLabel, suggestedFilament } from './plateRecord'

const plate: SlicedPlate = {
  index: 1,
  objects: [
    { id: '264', name: 'Hull.stl_A', grams: [0, 80, 0] },
    { id: '332', grams: [0, 4, 1] },
  ],
  overhead: [0, 2, 0.5],
  filaments: [
    { slot: 1, type: 'PLA', color: '#6F5034', density: 1.26, diameter: 1.75 },
    { slot: 2, type: 'PETG', color: '#000000', density: 1.27, diameter: 1.75 },
  ],
}

describe('measuredRecord', () => {
  const record = measuredRecord('plate', plate, ['hull', undefined], [{ consumableId: 'brown' }, { name: 'Black PETG' }], 90)

  it('takes each object’s amounts for the filaments the plate uses only', () => {
    expect(record.objects).toEqual([{ requestId: 'hull', amounts: [80, 0] }, { amounts: [4, 1] }])
  })

  it('takes the overhead of those filaments', () => {
    expect(record.overhead).toEqual([2, 0.5])
  })

  it('keeps the chosen materials in filament order', () => {
    expect(record.materials).toEqual([{ consumableId: 'brown' }, { name: 'Black PETG' }])
  })
})

describe('slicedObjectLabel', () => {
  it('uses the object’s name', () => {
    expect(slicedObjectLabel(plate.objects[0], (id) => `Object ${id}`)).toBe('Hull.stl_A')
  })

  it('falls back to its label number', () => {
    expect(slicedObjectLabel(plate.objects[1], (id) => `Object ${id}`)).toBe('Object 332')
  })
})

describe('suggestedFilament', () => {
  const brown: Consumable = {
    id: 'brown',
    kind: 'filament',
    name: 'Bambu PLA Basic · Brown',
    colour: { name: 'Brown', hex: '#6f5034' },
    pricePerKg: 20,
  }
  const black: Consumable = {
    id: 'black',
    kind: 'filament',
    name: 'Generic PETG',
    colour: { name: 'Black', hex: '#000000' },
    pricePerKg: 25,
  }
  const greyPla: Consumable = { id: 'grey', kind: 'filament', name: 'PLA Grey', colour: { name: 'Grey', hex: '#888888' }, pricePerKg: 18 }

  it('picks the library filament of the same colour', () => {
    expect(suggestedFilament([greyPla, brown], { type: 'PLA', color: '#6F5034' })).toBe('brown')
  })

  it('prefers the colour and type both matching', () => {
    expect(suggestedFilament([black, { ...black, id: 'black-pla', name: 'Black PLA' }], { type: 'PLA', color: '#000000' })).toBe(
      'black-pla',
    )
  })

  it('falls back to a filament of the same type', () => {
    expect(suggestedFilament([black, greyPla], { type: 'PLA', color: '#ff0000' })).toBe('grey')
  })

  it('suggests nothing when neither matches', () => {
    expect(suggestedFilament([black], { type: 'PLA', color: '#ff0000' })).toBeUndefined()
  })

  it('reads the type from the catalogue entry', () => {
    expect(
      suggestedFilament(
        [{ ...black, name: 'Matte Black', filamentPresetId: 'petg-preset' }],
        { type: 'PETG' },
        new Map([['petg-preset', 'PETG']]),
      ),
    ).toBe('black')
  })

  it('never suggests an archived filament', () => {
    expect(suggestedFilament([{ ...brown, archived: true }], { type: 'PLA', color: '#6F5034' })).toBeUndefined()
  })
})
