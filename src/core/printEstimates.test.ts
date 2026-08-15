import { describe, expect, it } from 'vitest'
import { automaticPrintEstimate, effectivePrintEstimate, formatEstimateTime } from './printEstimates'

describe('print estimates', () => {
  it('uses solid model volume instead of applying a blanket infill discount', () => {
    const estimate = automaticPrintEstimate({ printType: 'filament', modelVolumeMm3: 10_000, modelHeightMm: 20 })
    expect(estimate).toMatchObject({ materialUnit: 'g' })
    expect(estimate?.material).toBeCloseTo(12.4)
    expect(estimate?.minutes).toBeCloseTo(78.4)
  })

  it('accounts for layer time on small filament models', () => {
    const estimate = automaticPrintEstimate({ printType: 'filament', modelVolumeMm3: 782.26, modelHeightMm: 18 })
    expect(estimate?.material).toBeCloseTo(0.97, 2)
    expect(estimate?.minutes).toBeCloseTo(16)
  })

  it('estimates resin material from volume and time from height', () => {
    expect(automaticPrintEstimate({ printType: 'resin', modelVolumeMm3: 10_000, modelHeightMm: 20 })).toEqual({
      material: 11.5,
      materialUnit: 'ml',
      minutes: 59,
    })
  })

  it('uses editable values without losing their provenance', () => {
    expect(
      effectivePrintEstimate({
        printType: 'filament',
        modelVolumeMm3: 10_000,
        materialOverride: 7,
        minutesOverride: 45,
      }),
    ).toMatchObject({ material: 7, minutes: 45, materialAdjusted: true, minutesAdjusted: true })
  })

  it('formats durations for the board', () => {
    expect(formatEstimateTime(135)).toBe('2h 15m')
  })
})
