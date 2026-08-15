import { describe, expect, it } from 'vitest'
import { automaticPrintEstimate, effectivePrintEstimate, formatEstimateTime } from './printEstimates'

describe('print estimates', () => {
  it('estimates filament material and time from model volume', () => {
    const estimate = automaticPrintEstimate({ printType: 'filament', modelVolumeMm3: 10_000 })
    expect(estimate).toMatchObject({ materialUnit: 'g' })
    expect(estimate?.material).toBeCloseTo(4.96)
    expect(estimate?.minutes).toBeCloseTo(37.2)
  })

  it('estimates resin material from volume and time from height', () => {
    expect(automaticPrintEstimate({ printType: 'resin', modelVolumeMm3: 10_000, modelHeightMm: 20 })).toEqual({
      material: 11.5,
      materialUnit: 'ml',
      minutes: 54,
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
