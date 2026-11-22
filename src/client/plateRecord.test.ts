import { describe, expect, it } from 'vitest'
import type { SlicedPlate } from '../core/slicedPlate'
import { measuredRecord, slicedObjectLabel } from './plateRecord'

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
