import { describe, expect, it } from 'vitest'
import type { PartConsumable } from './consumables'
import { partWear } from './maintenance'
import type { UsageEvent } from './usage'

const tank: PartConsumable = {
  id: 'tank',
  kind: 'part',
  name: 'Tank',
  printType: 'resin',
  price: 119,
  lifespan: 190,
  lifespanUnit: 'plates',
}
const screen: PartConsumable = { ...tank, id: 'screen', lifespan: 2000, lifespanUnit: 'hours' }

let sequence = 0
function event(overrides: Partial<UsageEvent>): UsageEvent {
  sequence += 1
  return {
    id: `event-${sequence}`,
    transactionId: `transaction-${sequence}`,
    stage: 'printing',
    kind: 'use',
    printerId: 'form-4-a',
    amount: 120,
    unit: 'minute',
    copies: 1,
    createdAt: sequence,
    ...overrides,
  }
}

describe('part wear', () => {
  it('counts every copy the printer printed as a plate', () => {
    expect(partWear([event({ copies: 3 }), event({ copies: 2 })], 'form-4-a', tank).used).toBe(5)
  })

  it('leaves out the wear a deleted part recorded, which no longer names it', () => {
    const deletedPartWear = event({ amount: 90, deletedItemName: 'FEP', deletedItemKind: 'part' })
    expect(partWear([event({ amount: 90 }), deletedPartWear], 'form-4-a', screen).used).toBe(1.5)
  })

  it('counts printing minutes as hours', () => {
    expect(partWear([event({ amount: 90 }), event({ amount: 30 })], 'form-4-a', screen).used).toBe(2)
  })

  it('counts failed runs, which wore the part too', () => {
    expect(partWear([event({ outcome: 'failed' })], 'form-4-a', tank).used).toBe(1)
  })

  it('ignores other printers', () => {
    expect(partWear([event({ printerId: 'form-4-b' })], 'form-4-a', tank).used).toBe(0)
  })

  it('ignores the material a print used', () => {
    expect(partWear([event({ consumableId: 'resin', unit: 'ml', amount: 40 })], 'form-4-a', tank).used).toBe(0)
  })

  it('ignores undone prints', () => {
    expect(partWear([event({ undoneAt: 99 })], 'form-4-a', tank).used).toBe(0)
  })

  it('ignores estimates of past prints, which predate any replacement on record', () => {
    expect(partWear([event({ estimated: true })], 'form-4-a', tank).used).toBe(0)
  })

  it('starts counting again after the part is replaced on the printer', () => {
    const events = [
      event({ copies: 4 }),
      event({ stage: 'stock', kind: 'replace', consumableId: 'tank', unit: 'item', amount: 1 }),
      event({}),
    ]
    expect(partWear(events, 'form-4-a', tank).used).toBe(1)
  })

  it('keeps counting when another part is replaced', () => {
    const events = [event({}), event({ stage: 'stock', kind: 'replace', consumableId: 'screen', unit: 'item', amount: 1 }), event({})]
    expect(partWear(events, 'form-4-a', tank).used).toBe(2)
  })

  it('keeps counting when the replacement is undone', () => {
    const events = [
      event({}),
      event({ stage: 'stock', kind: 'replace', consumableId: 'tank', unit: 'item', amount: 1, undoneAt: 99 }),
      event({}),
    ]
    expect(partWear(events, 'form-4-a', tank).used).toBe(2)
  })

  it('is due once it reaches its lifespan', () => {
    expect(partWear([event({ copies: 190 })], 'form-4-a', tank).due).toBe(true)
  })
})
