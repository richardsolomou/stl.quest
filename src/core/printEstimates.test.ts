import { describe, expect, it } from 'vitest'
import { messagesFor } from './i18n'
import {
  automaticPrintEstimate,
  effectivePrintEstimate,
  estimatePending,
  formatEstimateMaterial,
  formatEstimateTime,
} from './printEstimates'

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

  it('treats only queued or running geometry as a pending estimate', () => {
    expect(estimatePending({ estimateGeometryStatus: 'pending' })).toBe(true)
    expect(estimatePending({ estimateGeometryStatus: 'running' })).toBe(true)
    expect(estimatePending({ estimateGeometryStatus: 'ready' })).toBe(false)
    expect(estimatePending({ estimateGeometryStatus: 'failed' })).toBe(false)
    expect(estimatePending({})).toBe(false)
  })

  it('formats durations for the board', () => {
    expect(formatEstimateTime(135, messagesFor('en').requests)).toBe('2h 15m')
  })

  it('formats an estimate time in German', () => {
    expect(formatEstimateTime(135, messagesFor('de').requests)).toBe('2 Std. 15 Min.')
  })

  it('formats a material estimate with a French decimal comma', () => {
    expect(formatEstimateMaterial(12.04, 'fr')).toBe('12,0')
  })

  it('keeps a large English material estimate ungrouped', () => {
    expect(formatEstimateMaterial(1234.4)).toBe('1234')
  })

  it('drops trailing zeros from a small material estimate', () => {
    expect(formatEstimateMaterial(1.5)).toBe('1.5')
  })
})
