import { describe, expect, it } from 'vitest'
import type { Consumable } from './consumables'
import { DEFAULT_MATERIAL_ESTIMATE_SETTINGS } from './printEstimates'
import type { PrinterProfile } from './types'
import { backfillSummary, usageBackfill, type BackfillRequest } from './usageBackfill'

const rates = { ...DEFAULT_MATERIAL_ESTIMATE_SETTINGS, electricityPricePerKwh: 0.3 }
const printer: PrinterProfile = { id: 'saturn', name: 'Saturn', printType: 'resin' }
const grey: Consumable = { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 40, densityGramsPerMl: 1.1 }
const tank: Consumable = { id: 'tank', kind: 'part', name: 'Tank', printType: 'resin', price: 190, lifespan: 190, lifespanUnit: 'plates' }
const library = { rates, printers: [printer], consumables: [grey, tank], recorded: new Set<string>() }

function print(overrides: Partial<BackfillRequest> = {}): BackfillRequest {
  return {
    id: 'print',
    quantity: 4,
    counts: { done: 3, todo: 1 },
    completedAt: 3_000,
    updatedAt: 9_000,
    printerId: printer.id,
    estimatedMaterialOverride: 12,
    estimatedPrintMinutesOverride: 90,
    ...overrides,
  }
}

function backfilled(request: BackfillRequest, resolved: Partial<typeof library> = {}) {
  return usageBackfill([request], { ...library, ...resolved })
}

describe('usageBackfill dating', () => {
  it('dates a print when its copies reached Ready', () => {
    expect(backfilled(print())[0].usedAt).toBe(3_000)
  })

  it('dates an archived print without Ready copies when it was archived', () => {
    expect(backfilled(print({ counts: { todo: 4 }, completedAt: undefined, archivedAt: 5_000 }))[0].usedAt).toBe(5_000)
  })

  it('dates a print with neither by its last update', () => {
    expect(backfilled(print({ completedAt: undefined }))[0].usedAt).toBe(9_000)
  })
})

describe('usageBackfill copies', () => {
  it('counts the copies that reached Ready', () => {
    expect(backfilled(print())[0].copies).toBe(3)
  })

  it('counts every copy of an archived print with none Ready', () => {
    expect(backfilled(print({ counts: { todo: 4 }, completedAt: undefined, archivedAt: 5_000 }))[0].copies).toBe(4)
  })

  it('records the copies on every event', () => {
    expect(new Set(backfilled(print())[0].drafts.map((draft) => draft.copies))).toEqual(new Set([3]))
  })

  it('skips a print with nothing Ready that was never archived', () => {
    expect(backfilled(print({ counts: { in_progress: 4 } }))).toEqual([])
  })
})

describe('usageBackfill eligibility', () => {
  it('skips a print that already has usage', () => {
    expect(backfilled(print(), { recorded: new Set(['print']) })).toEqual([])
  })

  it('skips a print without a print type', () => {
    expect(backfilled(print({ printerId: undefined, requestedPrintType: undefined }))).toEqual([])
  })

  it('skips a print without an estimated time', () => {
    expect(backfilled(print({ estimatedPrintMinutesOverride: undefined }))).toEqual([])
  })

  it('skips a print without an estimated material', () => {
    expect(backfilled(print({ estimatedMaterialOverride: undefined }))).toEqual([])
  })

  it('skips a print with neither a printer nor a material to record', () => {
    expect(backfilled(print({ printerId: undefined, requestedPrintType: 'resin' }), { consumables: [] })).toEqual([])
  })
})

describe('usageBackfill events', () => {
  const shape = (request: BackfillRequest, resolved: Partial<typeof library> = {}) =>
    backfilled(request, resolved)[0].drafts.map(({ printerId, consumableId, amount, unit }) => ({ printerId, consumableId, amount, unit }))

  it('records the printer minutes, wear, and material of every Ready copy', () => {
    expect(shape(print())).toEqual([
      { printerId: printer.id, consumableId: undefined, amount: 270, unit: 'minute' },
      { printerId: printer.id, consumableId: tank.id, amount: 3, unit: 'plate' },
      { printerId: printer.id, consumableId: grey.id, amount: 36, unit: 'ml' },
    ])
  })

  it('adds the supports and waste allowance to a print estimated from its model', () => {
    const modelled = print({
      estimatedMaterialOverride: undefined,
      modelVolumeMm3: 10_000,
      modelDimensions: { widthMm: 10, depthMm: 10, heightMm: 20 },
    })
    expect(shape(modelled).at(-1)?.amount).toBeCloseTo(51)
  })

  it('records an adjusted material without the allowance', () => {
    const generous = { ...rates, supportsAndWastePercent: { resin: 200, filament: 200 } }
    expect(shape(print(), { rates: generous }).at(-1)?.amount).toBe(36)
  })

  it('records only the material of a print without a printer', () => {
    expect(shape(print({ printerId: undefined, requestedPrintType: 'resin' }))).toEqual([
      { printerId: undefined, consumableId: grey.id, amount: 36, unit: 'ml' },
    ])
  })

  it('records only the material of a print on an archived printer', () => {
    expect(shape(print(), { printers: [{ ...printer, archived: true }] })).toEqual([
      { printerId: undefined, consumableId: grey.id, amount: 36, unit: 'ml' },
    ])
  })

  it('records no material when the library has none of the print type', () => {
    expect(shape(print(), { consumables: [tank] }).map(({ consumableId }) => consumableId)).toEqual([undefined, tank.id])
  })

  it('uses the first material of the print type still in the library', () => {
    const black: Consumable = { ...grey, id: 'black', name: 'Black' }
    expect(shape(print(), { consumables: [{ ...grey, archived: true }, black] }).at(-1)?.consumableId).toBe(black.id)
  })

  it('marks every event estimated', () => {
    expect(new Set(backfilled(print())[0].drafts.map((draft) => draft.estimated))).toEqual(new Set([true]))
  })

  it('records the printing stage', () => {
    expect(new Set(backfilled(print())[0].drafts.map((draft) => draft.stage))).toEqual(new Set(['printing']))
  })
})

describe('backfillSummary', () => {
  it('counts prints, copies, and events with the dates they span', () => {
    const prints = usageBackfill(
      [print(), print({ id: 'later', counts: { done: 2 }, completedAt: 7_000 }), print({ id: 'earlier', completedAt: 1_000 })],
      library,
    )

    expect(backfillSummary(prints)).toEqual({ prints: 3, copies: 8, events: 9, from: 1_000, to: 7_000 })
  })

  it('has no dates when nothing is filled in', () => {
    expect(backfillSummary([])).toEqual({ prints: 0, copies: 0, events: 0 })
  })
})
