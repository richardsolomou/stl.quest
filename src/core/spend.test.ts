import { describe, expect, it } from 'vitest'
import type { Consumable } from './consumables'
import { costBasis, localDay, spendCategory, spendPeriod, spendTrend, summariseProfit, summariseSpend, usageSteps } from './spend'
import type { UsageEvent } from './usage'

const resin: Consumable = { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 40, densityGramsPerMl: 1.1 }
const ipa: Consumable = { id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 10 }
const tank: Consumable = { id: 'tank', kind: 'part', name: 'Tank', printType: 'resin', price: 100, lifespan: 190, lifespanUnit: 'plates' }
const library = new Map([resin, ipa, tank].map((consumable) => [consumable.id, consumable]))

let next = 0
function event(overrides: Partial<UsageEvent> = {}): UsageEvent {
  next++
  return {
    id: `event-${next}`,
    transactionId: `transaction-${next}`,
    stage: 'printing',
    kind: 'use',
    amount: 1,
    unit: 'ml',
    currency: 'EUR',
    createdAt: 1_000,
    ...overrides,
  }
}

describe('spendCategory', () => {
  it('files a resin as material', () => {
    expect(spendCategory(event({ consumableId: resin.id }), library)).toBe('material')
  })

  it('files a supply as a supply', () => {
    expect(spendCategory(event({ consumableId: ipa.id, equipmentId: 'wash' }), library)).toBe('supply')
  })

  it('files a wear part as a part', () => {
    expect(spendCategory(event({ consumableId: tank.id, kind: 'replace' }), library)).toBe('part')
  })

  it('files equipment time as equipment', () => {
    expect(spendCategory(event({ equipmentId: 'wash', unit: 'minute' }), library)).toBe('equipment')
  })

  it('files printer time as the printer', () => {
    expect(spendCategory(event({ printerId: 'form', unit: 'minute' }), library)).toBe('printer')
  })

  it('files a removed consumable used while printing as material', () => {
    expect(spendCategory(event({ consumableId: 'gone', printerId: 'form' }), library)).toBe('material')
  })

  it('files a removed consumable worn by the minute as a part', () => {
    expect(spendCategory(event({ consumableId: 'gone', printerId: 'x1c', unit: 'minute' }), library)).toBe('part')
  })

  it('files a removed consumable used in finishing as a supply', () => {
    expect(spendCategory(event({ consumableId: 'gone', stage: 'finishing', equipmentId: 'wash' }), library)).toBe('supply')
  })
})

describe('summariseSpend', () => {
  it('adds up uses at the price each recorded', () => {
    const summary = summariseSpend(
      [event({ consumableId: resin.id, amount: 100, unitPrice: 0.04 }), event({ consumableId: resin.id, amount: 50, unitPrice: 0.05 })],
      [resin],
      'EUR',
    )

    expect(summary.total).toBeCloseTo(6.5)
  })

  it('includes estimates of past prints in the total', () => {
    const summary = summariseSpend(
      [
        event({ consumableId: resin.id, amount: 100, unitPrice: 0.04 }),
        event({ consumableId: resin.id, amount: 50, unitPrice: 0.04, estimated: true }),
      ],
      [resin],
      'EUR',
    )

    expect(summary.total).toBeCloseTo(6)
  })

  it('says how much of the total was estimated rather than taken from the slicer', () => {
    const summary = summariseSpend(
      [
        event({ consumableId: resin.id, amount: 100, unitPrice: 0.04, plateId: 'plate' }),
        event({ consumableId: resin.id, amount: 50, unitPrice: 0.04, estimated: true }),
        event({ consumableId: resin.id, amount: 25, unitPrice: 0.04 }),
      ],
      [resin],
      'EUR',
    )

    expect(summary.estimated).toBeCloseTo(3)
  })

  it('says how much of the total came from slicer totals', () => {
    const summary = summariseSpend(
      [
        event({ consumableId: resin.id, amount: 100, unitPrice: 0.04, plateId: 'plate' }),
        event({ consumableId: resin.id, amount: 50, unitPrice: 0.04 }),
      ],
      [resin],
      'EUR',
    )

    expect(summary.slicer).toBeCloseTo(4)
  })

  it('marks a print whose spend was estimated', () => {
    const summary = summariseSpend(
      [event({ requestId: 'past', consumableId: resin.id, amount: 50, unitPrice: 0.04, estimated: true })],
      [resin],
      'EUR',
    )

    expect(summary.prints).toEqual([expect.objectContaining({ requestId: 'past', estimated: true })])
  })

  it('marks a print whose spend came from the slicer', () => {
    const summary = summariseSpend(
      [event({ requestId: 'plated', consumableId: resin.id, amount: 50, unitPrice: 0.04, plateId: 'plate' })],
      [resin],
      'EUR',
    )

    expect(summary.prints).toEqual([expect.objectContaining({ requestId: 'plated', slicer: true, estimated: false })])
  })

  it('leaves out undone events', () => {
    const summary = summariseSpend([event({ consumableId: resin.id, amount: 100, unitPrice: 1, undoneAt: 2_000 })], [resin], 'EUR')

    expect(summary.total).toBe(0)
  })

  it('leaves out restocks and corrections', () => {
    const summary = summariseSpend(
      [
        event({ stage: 'stock', kind: 'restock', consumableId: resin.id, amount: 1_000, unitPrice: 1 }),
        event({ stage: 'stock', kind: 'correction', consumableId: resin.id, amount: -20, unitPrice: 1 }),
      ],
      [resin],
      'EUR',
    )

    expect(summary.total).toBe(0)
  })

  it('keeps an event priced in another currency out of the total', () => {
    const summary = summariseSpend([event({ consumableId: resin.id, amount: 10, unitPrice: 1, currency: 'USD' })], [resin], 'EUR')

    expect(summary.total).toBe(0)
  })

  it('totals each other currency on its own, most spent first', () => {
    const summary = summariseSpend(
      [
        event({ consumableId: resin.id, amount: 10, unitPrice: 1, currency: 'USD' }),
        event({ consumableId: resin.id, amount: 30, unitPrice: 1, currency: 'GBP' }),
        event({ consumableId: resin.id, amount: 5, unitPrice: 1, currency: 'USD' }),
        event({ consumableId: resin.id, amount: 7, unitPrice: 1 }),
      ],
      [resin],
      'EUR',
    )

    expect(summary.otherCurrencies).toEqual([
      { currency: 'GBP', total: 30 },
      { currency: 'USD', total: 15 },
    ])
  })

  it('keeps another currency out of each print’s cost', () => {
    const summary = summariseSpend(
      [
        event({ requestId: 'a', consumableId: resin.id, amount: 5, unitPrice: 1 }),
        event({ requestId: 'a', consumableId: resin.id, amount: 9, unitPrice: 1, currency: 'GBP' }),
      ],
      [resin],
      'EUR',
    )

    expect(summary.prints).toEqual([{ requestId: 'a', cost: 5, failed: false, estimated: true, slicer: false }])
  })

  it('keeps another currency out of the items', () => {
    const summary = summariseSpend([event({ consumableId: resin.id, amount: 9, unitPrice: 1, currency: 'GBP' })], [resin], 'EUR')

    expect(summary.items).toEqual([])
  })

  it('counts a consumable used without a price', () => {
    const summary = summariseSpend([event({ consumableId: ipa.id, amount: 20, currency: undefined })], [ipa], 'EUR')

    expect(summary.unpriced).toBe(1)
  })

  it('separates waste and failed runs from use', () => {
    const summary = summariseSpend(
      [
        event({ consumableId: resin.id, amount: 10, unitPrice: 1 }),
        event({ consumableId: resin.id, amount: 3, unitPrice: 1, outcome: 'failed' }),
        event({ stage: 'stock', kind: 'waste', consumableId: resin.id, amount: 2, unitPrice: 1 }),
      ],
      [resin],
      'EUR',
    )

    expect(summary.outcomes).toEqual({ used: 10, failed: 3, wasted: 2 })
  })

  it('sums each item across events, most spent first', () => {
    const summary = summariseSpend(
      [
        event({ consumableId: ipa.id, stage: 'finishing', equipmentId: 'wash', amount: 20, unitPrice: 0.01 }),
        event({ consumableId: resin.id, amount: 30, unitPrice: 0.04 }),
        event({ consumableId: ipa.id, stage: 'finishing', equipmentId: 'wash', amount: 20, unitPrice: 0.01 }),
      ],
      [resin, ipa],
      'EUR',
    )

    expect(summary.items.map(({ id, amount }) => ({ id, amount }))).toEqual([
      { id: resin.id, amount: 30 },
      { id: ipa.id, amount: 40 },
    ])
  })

  it('totals each print and marks it failed when any run failed', () => {
    const summary = summariseSpend(
      [
        event({ requestId: 'a', consumableId: resin.id, amount: 5, unitPrice: 1 }),
        event({ requestId: 'b', consumableId: resin.id, amount: 2, unitPrice: 1, outcome: 'failed' }),
        event({ requestId: 'b', consumableId: resin.id, amount: 2, unitPrice: 1 }),
      ],
      [resin],
      'EUR',
    )

    expect(summary.prints).toEqual([
      { requestId: 'a', cost: 5, failed: false, estimated: true, slicer: false },
      { requestId: 'b', cost: 4, failed: true, estimated: true, slicer: false },
    ])
  })

  it('splits spend by category', () => {
    const summary = summariseSpend(
      [
        event({ printerId: 'form', unit: 'minute', amount: 60, unitPrice: 0.25 }),
        event({ consumableId: resin.id, amount: 10, unitPrice: 0.5 }),
        event({ stage: 'finishing', equipmentId: 'wash', unit: 'minute', amount: 10, unitPrice: 0.125 }),
      ],
      [resin],
      'EUR',
    )

    expect(summary.categories).toEqual({ material: 5, printer: 15, equipment: 1.25, supply: 0, part: 0 })
  })
})

describe('usageSteps', () => {
  it('groups a print’s events by the action that recorded them, oldest first', () => {
    const steps = usageSteps([
      event({ transactionId: 'finish', stage: 'finishing', equipmentId: 'wash', unit: 'minute', createdAt: 2_000 }),
      event({ transactionId: 'print', printerId: 'form', unit: 'minute', createdAt: 1_000 }),
      event({ transactionId: 'print', consumableId: resin.id, createdAt: 1_000 }),
    ])

    expect(steps.map(({ transactionId, events }) => [transactionId, events.length])).toEqual([
      ['print', 2],
      ['finish', 1],
    ])
  })

  it('prices a step in the currency it was recorded in', () => {
    const [step] = usageSteps([event({ printerId: 'form', unit: 'minute', amount: 60, unitPrice: 0.5, currency: 'GBP' })])

    expect([step.cost, step.currency]).toEqual([30, 'GBP'])
  })

  it('marks a step failed when its run failed', () => {
    const [step] = usageSteps([event({ printerId: 'form', unit: 'minute', outcome: 'failed' })])

    expect(step.failed).toBe(true)
  })

  it('marks a step estimated from a past print', () => {
    const [step] = usageSteps([event({ printerId: 'form', unit: 'minute', estimated: true })])

    expect(step.estimated).toBe(true)
  })
})

describe('spendPeriod', () => {
  const now = new Date(2026, 10, 20, 15, 30).getTime()

  it('runs this month from its first day to the end of today', () => {
    expect(spendPeriod('month', now)).toEqual({ from: new Date(2026, 10, 1).getTime(), to: new Date(2026, 10, 21).getTime() })
  })

  it('covers thirty days including today', () => {
    expect(spendPeriod('30-days', now).from).toBe(new Date(2026, 9, 22).getTime())
  })

  it('covers three months back to the day after the same date', () => {
    expect(spendPeriod('3-months', now).from).toBe(new Date(2026, 7, 21).getTime())
  })

  it('includes both days of a custom range given in either order', () => {
    expect(spendPeriod('custom', now, { from: '2026-11-05', to: '2026-11-01' })).toEqual({
      from: new Date(2026, 10, 1).getTime(),
      to: new Date(2026, 10, 6).getTime(),
    })
  })
})

describe('localDay', () => {
  it('rejects a date that does not exist', () => {
    expect(localDay('2026-02-30')).toBeUndefined()
  })
})

describe('spendTrend', () => {
  it('buckets a month by day', () => {
    const period = { from: new Date(2026, 10, 1).getTime(), to: new Date(2026, 11, 1).getTime() }

    expect(spendTrend([], period, 'EUR')).toHaveLength(30)
  })

  it('buckets three months by week', () => {
    const period = { from: new Date(2026, 7, 21).getTime(), to: new Date(2026, 10, 21).getTime() }

    expect(spendTrend([], period, 'EUR')).toHaveLength(14)
  })

  it('adds each event to the day it happened', () => {
    const period = { from: new Date(2026, 10, 1).getTime(), to: new Date(2026, 10, 4).getTime() }
    const trend = spendTrend(
      [event({ consumableId: resin.id, amount: 2, unitPrice: 1, createdAt: new Date(2026, 10, 2, 23, 59).getTime() })],
      period,
      'EUR',
    )

    expect(trend.map(({ cost }) => cost)).toEqual([0, 2, 0])
  })

  it('leaves spend in another currency out of the trend', () => {
    const period = { from: new Date(2026, 10, 1).getTime(), to: new Date(2026, 10, 2).getTime() }
    const trend = spendTrend(
      [event({ consumableId: resin.id, amount: 2, unitPrice: 1, currency: 'GBP', createdAt: new Date(2026, 10, 1, 12).getTime() })],
      period,
      'EUR',
    )

    expect(trend.map(({ cost }) => cost)).toEqual([0])
  })
})

describe('costBasis', () => {
  it('takes plate usage from the slicer', () => {
    expect(costBasis(event({ plateId: 'plate' }))).toBe('slicer')
  })

  it('takes a printing step from the print’s estimate', () => {
    expect(costBasis(event())).toBe('estimate')
  })

  it('takes a filled-in print from its estimate', () => {
    expect(costBasis(event({ estimated: true }))).toBe('estimate')
  })

  it('gives finishing no basis of its own', () => {
    expect(costBasis(event({ stage: 'finishing' }))).toBeUndefined()
  })
})

describe('summariseProfit', () => {
  const october = { from: new Date(2026, 9, 1).getTime(), to: new Date(2026, 10, 1).getTime() }
  const november = { from: new Date(2026, 10, 1).getTime(), to: new Date(2026, 11, 1).getTime() }
  const finishedInNovember = new Date(2026, 10, 12).getTime()
  // Printed in October and finished in November: its €8 cost covers both months.
  const spanning = { requestId: 'a', charged: { amount: 20, currency: 'EUR' as const }, cost: 8, finishedAt: finishedInNovember }

  it('counts a charge in the period its print finished', () => {
    expect(summariseProfit([spanning], november, 'EUR').earned).toBe(20)
  })

  it('leaves a charge out of a period before its print finished', () => {
    expect(summariseProfit([spanning], october, 'EUR').charged).toBe(0)
  })

  it('sets a charge against everything its print used', () => {
    expect(summariseProfit([spanning], november, 'EUR').profit).toBe(12)
  })

  it('totals what the counted prints used', () => {
    expect(summariseProfit([spanning, { ...spanning, requestId: 'b', cost: 3 }], november, 'EUR').spent).toBe(11)
  })

  it('gives each counted print its profit', () => {
    expect(summariseProfit([spanning], november, 'EUR').byPrint.get('a')).toBe(12)
  })

  it('leaves out a print that never finished', () => {
    expect(summariseProfit([{ ...spanning, finishedAt: undefined }], november, 'EUR').charged).toBe(0)
  })

  it('leaves out a charge in another currency', () => {
    expect(summariseProfit([{ ...spanning, charged: { amount: 20, currency: 'GBP' } }], november, 'EUR').charged).toBe(0)
  })

  it('counts a print that finished at the start of the period', () => {
    expect(summariseProfit([{ ...spanning, finishedAt: november.from }], november, 'EUR').charged).toBe(1)
  })

  it('leaves out a print that finished at the end of the period', () => {
    expect(summariseProfit([{ ...spanning, finishedAt: october.to }], october, 'EUR').charged).toBe(0)
  })
})
