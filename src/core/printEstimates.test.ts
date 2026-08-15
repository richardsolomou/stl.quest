import { describe, expect, it } from 'vitest'
import { automaticPrintEstimate, effectivePrintEstimate, formatEstimateTime } from './printEstimates'

describe('print estimates', () => {
  it('combines a dense shell with 15% internal infill', () => {
    const estimate = automaticPrintEstimate({
      printType: 'filament',
      modelVolumeMm3: 10_000,
      modelSurfaceAreaMm2: 3_000,
      modelHeightMm: 20,
    })
    expect(estimate).toMatchObject({ materialUnit: 'g' })
    expect(estimate?.material).toBeGreaterThan(5)
    expect(estimate?.material).toBeLessThan(7)
  })

  it('tracks slicer results for larger sparse-infill holders', () => {
    const large = automaticPrintEstimate({
      printType: 'filament',
      modelVolumeMm3: (253 / 1.24) * 1_000,
      modelSurfaceAreaMm2: 33_250,
      modelHeightMm: 50,
    })
    const small = automaticPrintEstimate({
      printType: 'filament',
      modelVolumeMm3: (101 / 1.24) * 1_000,
      modelSurfaceAreaMm2: 14_900,
      modelHeightMm: 50,
    })

    expect(large?.material).toBeCloseTo(80, -1)
    expect(large?.minutes).toBeCloseTo(116, -1)
    expect(small?.material).toBeCloseTo(34, -1)
    expect(small?.minutes).toBeCloseTo(58, -1)
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
