import { describe, expect, it } from 'vitest'
import type { PartConsumable } from './consumables'
import {
  isPastPurchaseDate,
  ownedFor,
  partWear,
  printerAttention,
  printerLifetimes,
  wearingParts,
  wearLevel,
  type MaintenanceTotals,
  type PartWear,
  type PrinterLifetime,
} from './maintenance'
import type { PrinterProfile } from './types'

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
const form4: PrinterProfile = { id: 'form-4-a', name: 'Form 4', printType: 'resin', lifespanHours: 5_000 }

function totals(overrides: Partial<MaintenanceTotals> = {}): MaintenanceTotals {
  return {
    printers: [{ printerId: 'form-4-a', all: { minutes: 600, plates: 12 }, recorded: { minutes: 480, plates: 9 } }],
    replacements: [],
    ...overrides,
  }
}

describe('wear level', () => {
  it('is fresh before most of the lifespan is used', () => {
    expect(wearLevel(79, 100)).toBe('fresh')
  })

  it('is nearly worn from 80% of the lifespan', () => {
    expect(wearLevel(80, 100)).toBe('nearly')
  })

  it('is due once the lifespan is reached', () => {
    expect(wearLevel(100, 100)).toBe('due')
  })

  it('is never due without a lifespan', () => {
    expect(wearLevel(500, 0)).toBe('fresh')
  })
})

describe('part wear', () => {
  it('counts the recorded plates the printer ran when the part was never replaced', () => {
    expect(partWear(totals(), 'form-4-a', tank).used).toBe(9)
  })

  it('counts recorded printing minutes as hours', () => {
    expect(partWear(totals(), 'form-4-a', screen).used).toBe(8)
  })

  it('counts nothing on a printer that never ran', () => {
    expect(partWear(totals(), 'form-4-b', tank).used).toBe(0)
  })

  it('counts from the part’s last replacement on the printer', () => {
    const replaced = totals({
      replacements: [{ printerId: 'form-4-a', consumableId: 'tank', replacedAt: 50, since: { minutes: 60, plates: 2 } }],
    })
    expect(partWear(replaced, 'form-4-a', tank)).toMatchObject({ used: 2, replacedAt: 50 })
  })

  it('keeps counting when another part is replaced', () => {
    const replaced = totals({
      replacements: [{ printerId: 'form-4-a', consumableId: 'screen', replacedAt: 50, since: { minutes: 60, plates: 2 } }],
    })
    expect(partWear(replaced, 'form-4-a', tank).used).toBe(9)
  })

  it('is due once it reaches its lifespan', () => {
    const worn = totals({ printers: [{ printerId: 'form-4-a', all: { minutes: 0, plates: 190 }, recorded: { minutes: 0, plates: 190 } }] })
    expect(partWear(worn, 'form-4-a', tank).level).toBe('due')
  })
})

describe('printer lifetimes', () => {
  it('counts every print hour the printer ran, estimates of past prints included', () => {
    expect(printerLifetimes(totals(), [form4], [])[0].hours).toBe(10)
  })

  it('measures the printer against its own lifespan', () => {
    const worn = totals({
      printers: [{ printerId: 'form-4-a', all: { minutes: 300_000, plates: 1 }, recorded: { minutes: 0, plates: 0 } }],
    })
    expect(printerLifetimes(worn, [form4], [])[0]).toMatchObject({ lifespanHours: 5_000, level: 'due' })
  })

  it('lists the printer’s wear parts, most worn first', () => {
    expect(printerLifetimes(totals(), [form4], [screen, tank])[0].parts.map(({ consumableId }) => consumableId)).toEqual(['tank', 'screen'])
  })

  it('leaves out parts for another print type', () => {
    expect(printerLifetimes(totals(), [form4], [{ ...tank, printType: 'filament' }])[0].parts).toEqual([])
  })
})

function wear(consumableId: string, used: number, level: PartWear['level']): PartWear {
  return { consumableId, used, lifespan: 100, unit: 'plates', level }
}

function lifetime(overrides: Partial<PrinterLifetime> = {}): PrinterLifetime {
  return { printerId: 'form-4-a', hours: 10, lifespanHours: 100, level: 'fresh', parts: [], ...overrides }
}

describe('printer attention', () => {
  it('puts a printer past its lifespan first', () => {
    expect(printerAttention(lifetime({ level: 'due', parts: [wear('tank', 100, 'due')] }))).toEqual({ level: 'due' })
  })

  it('names the most worn part once it is nearly worn', () => {
    expect(printerAttention(lifetime({ level: 'nearly', parts: [wear('tank', 85, 'nearly')] }))?.part?.consumableId).toBe('tank')
  })

  it('says when the printer nears its lifespan', () => {
    expect(printerAttention(lifetime({ level: 'nearly', parts: [wear('tank', 10, 'fresh')] }))).toEqual({ level: 'nearly' })
  })

  it('needs nothing while everything is fresh', () => {
    expect(printerAttention(lifetime({ parts: [wear('tank', 10, 'fresh')] }))).toBeUndefined()
  })
})

describe('wearing parts', () => {
  it('lists nearly worn and due parts across printers, most worn first', () => {
    const lifetimes = [
      lifetime({ parts: [wear('tank', 85, 'nearly'), wear('film', 10, 'fresh')] }),
      lifetime({ printerId: 'form-4-b', parts: [wear('tank', 100, 'due')] }),
    ]
    expect(wearingParts(lifetimes).map(({ printerId, wear: { consumableId } }) => `${printerId}:${consumableId}`)).toEqual([
      'form-4-b:tank',
      'form-4-a:tank',
    ])
  })
})

describe('owned for', () => {
  it('counts whole months since the purchase', () => {
    expect(ownedFor('2025-03-14', '2026-11-22')).toEqual({ years: 1, months: 8 })
  })

  it('waits for the day of the month before counting a month', () => {
    expect(ownedFor('2026-10-23', '2026-11-22')).toEqual({ years: 0, months: 0 })
  })

  it('is never negative for a date ahead of today', () => {
    expect(ownedFor('2027-01-01', '2026-11-22')).toEqual({ years: 0, months: 0 })
  })
})

describe('past purchase date', () => {
  const now = Date.UTC(2026, 10, 22, 12)

  it('accepts today', () => {
    expect(isPastPurchaseDate('2026-11-22', now)).toBe(true)
  })

  it('accepts tomorrow in UTC, which is already today east of it', () => {
    expect(isPastPurchaseDate('2026-11-23', now)).toBe(true)
  })

  it('rejects a later day', () => {
    expect(isPastPurchaseDate('2026-11-24', now)).toBe(false)
  })
})
