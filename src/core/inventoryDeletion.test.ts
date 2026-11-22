import { describe, expect, it } from 'vitest'
import type { Consumable } from './consumables'
import type { EquipmentItem } from './equipment'
import {
  canDeleteInventoryItem,
  deletedItemKind,
  keepsDeletedName,
  NO_REFERENCES,
  referenceCount,
  withoutSupply,
} from './inventoryDeletion'
import type { PrinterProfile } from './types'

const printer: PrinterProfile = { id: 'form', name: 'Form 4', printType: 'resin' }
const pla: Consumable = { id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 20 }
const wash: EquipmentItem = {
  id: 'wash',
  name: 'Wash',
  kind: 'wash',
  stage: 'finishing',
  powerWatts: 50,
  minutesPerUse: 10,
  supplies: [
    { consumableId: 'ipa', amountPerUse: 100 },
    { consumableId: 'gloves', amountPerUse: 1 },
  ],
}

describe('canDeleteInventoryItem', () => {
  it('deletes an archived item', () => {
    expect(canDeleteInventoryItem({ ...printer, archived: true })).toBe(true)
  })

  it('keeps an item in use', () => {
    expect(canDeleteInventoryItem(printer)).toBe(false)
  })
})

describe('referenceCount', () => {
  it('adds every reference', () => {
    expect(referenceCount({ ...NO_REFERENCES, requests: 2, usage: 3, parts: 1 })).toBe(6)
  })
})

describe('deletedItemKind', () => {
  it('names a printer', () => {
    expect(deletedItemKind('printers', printer)).toBe('printer')
  })

  it('names equipment', () => {
    expect(deletedItemKind('equipment', wash)).toBe('equipment')
  })

  it('names a consumable by its kind', () => {
    expect(deletedItemKind('consumables', pla)).toBe('filament')
  })
})

describe('keepsDeletedName', () => {
  it('keeps a consumable’s name on usage that also names its printer', () => {
    expect(keepsDeletedName({ consumableId: 'pla' }, 'consumables')).toBe(true)
  })

  it('keeps a printer’s name on its printing time', () => {
    expect(keepsDeletedName({}, 'printers')).toBe(true)
  })

  it('leaves material usage to its material when the printer goes', () => {
    expect(keepsDeletedName({ consumableId: 'pla' }, 'printers')).toBe(false)
  })

  it('leaves a supply’s usage to the supply when its equipment goes', () => {
    expect(keepsDeletedName({ consumableId: 'ipa' }, 'equipment')).toBe(false)
  })

  it('keeps equipment’s name on its running time', () => {
    expect(keepsDeletedName({}, 'equipment')).toBe(true)
  })

  it('leaves equipment time to its equipment when a printer goes', () => {
    expect(keepsDeletedName({ equipmentId: 'wash' }, 'printers')).toBe(false)
  })

  it('never replaces the name of an item deleted before', () => {
    expect(keepsDeletedName({ deletedItemName: 'IPA' }, 'equipment')).toBe(false)
  })
})

describe('withoutSupply', () => {
  it('stops equipment using a deleted consumable', () => {
    expect(withoutSupply(wash, 'ipa').supplies).toEqual([{ consumableId: 'gloves', amountPerUse: 1 }])
  })
})
