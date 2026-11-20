import { describe, expect, it } from 'vitest'
import { messagesFor } from './i18n'
import {
  automaticEstimateFields,
  automaticPrintEstimate,
  DEFAULT_MATERIAL_ESTIMATE_SETTINGS,
  estimatePending,
  formatEstimateMaterial,
  formatEstimateTime,
  requestPrintEstimate,
  validMaterialEstimateSettings,
  type MaterialEstimateSettings,
} from './printEstimates'

const defaults = DEFAULT_MATERIAL_ESTIMATE_SETTINGS
const exact: MaterialEstimateSettings = { ...defaults, supportsAndWastePercent: { resin: 0, filament: 0 }, resinPerPartMl: 0 }

describe('print estimates', () => {
  it('combines a dense shell with 15% internal infill', () => {
    const estimate = automaticPrintEstimate(
      {
        printType: 'filament',
        modelVolumeMm3: 10_000,
        modelSurfaceAreaMm2: 3_000,
        modelHeightMm: 20,
      },
      defaults,
    )
    expect(estimate).toMatchObject({ materialUnit: 'g' })
    expect(estimate?.material).toBeGreaterThan(5)
    expect(estimate?.material).toBeLessThan(7)
  })

  it('tracks slicer results for larger sparse-infill holders with a light allowance', () => {
    // Simple holders carry little support, so the generous default overshoots them on purpose.
    const light: MaterialEstimateSettings = { ...defaults, supportsAndWastePercent: { ...defaults.supportsAndWastePercent, filament: 10 } }
    const large = automaticPrintEstimate(
      {
        printType: 'filament',
        modelVolumeMm3: (253 / 1.24) * 1_000,
        modelSurfaceAreaMm2: 33_250,
        modelHeightMm: 50,
      },
      light,
    )
    const small = automaticPrintEstimate(
      {
        printType: 'filament',
        modelVolumeMm3: (101 / 1.24) * 1_000,
        modelSurfaceAreaMm2: 14_900,
        modelHeightMm: 50,
      },
      light,
    )

    expect(large?.material).toBeCloseTo(80, -1)
    expect(large?.minutes).toBeCloseTo(116, -1)
    expect(small?.material).toBeCloseTo(34, -1)
    expect(small?.minutes).toBeCloseTo(58, -1)
  })

  it('accounts for layer time on small filament models', () => {
    const estimate = automaticPrintEstimate({ printType: 'filament', modelVolumeMm3: 782.26, modelHeightMm: 18 }, exact)
    expect(estimate?.material).toBeCloseTo(0.97, 2)
    expect(estimate?.minutes).toBeCloseTo(16)
  })

  it('estimates resin material from volume and time from height', () => {
    expect(automaticPrintEstimate({ printType: 'resin', modelVolumeMm3: 10_000, modelHeightMm: 20 }, exact)).toEqual({
      material: 10,
      materialUnit: 'ml',
      minutes: 59,
    })
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

  it('prefers the adjusted material over the automatic estimate', () => {
    expect(requestPrintEstimate({ printType: 'resin', automaticEstimatedMaterial: 10, estimatedMaterialOverride: 12 })?.material).toBe(12)
  })

  it('has no estimate without a print type', () => {
    expect(requestPrintEstimate({ automaticEstimatedMaterial: 10 })).toBeUndefined()
  })

  it('names the automatic estimate as a listed print carries it', () => {
    expect(automaticEstimateFields({ modelVolumeMm3: 10_000 }, 'resin', defaults).estimatedMaterialUnit).toBe('ml')
  })
})

describe('supports and waste allowance', () => {
  const resin = (settings: Partial<MaterialEstimateSettings>, modelVolumeMm3 = 10_000) =>
    automaticPrintEstimate({ printType: 'resin', modelVolumeMm3, modelHeightMm: 20 }, { ...exact, ...settings })
  const filament = (settings: Partial<MaterialEstimateSettings>) =>
    automaticPrintEstimate(
      { printType: 'filament', modelVolumeMm3: 10_000, modelSurfaceAreaMm2: 3_000, modelHeightMm: 20 },
      { ...exact, ...settings },
    )

  it('adds the resin percentage to the model volume', () => {
    expect(resin({ supportsAndWastePercent: { resin: 30, filament: 0 } })?.material).toBeCloseTo(13)
  })

  it('adds the resin amount per part on top', () => {
    expect(resin({ resinPerPartMl: 1 })?.material).toBeCloseTo(11)
  })

  it('reproduces the miniature calibration for a 0.6 mL part', () => {
    // PreForm auto-supports on eight real minis fit 1 mL per part plus 60% of the model best.
    expect(resin({ supportsAndWastePercent: { resin: 60, filament: 0 }, resinPerPartMl: 1 }, 600)?.material).toBeCloseTo(1.96)
  })

  it('adds the filament allowance to the shell and infill', () => {
    expect(filament({ supportsAndWastePercent: { resin: 0, filament: 10 } })?.material).toBeCloseTo(filament({})!.material! * 1.1)
  })

  it('adds no resin amount per part to filament', () => {
    expect(filament({ resinPerPartMl: 5 })?.material).toBe(filament({})?.material)
  })

  it('adds only the allowance of the estimate’s own print type', () => {
    expect(resin({ supportsAndWastePercent: { resin: 0, filament: 100 } })?.material).toBeCloseTo(10)
  })

  it('leaves resin time to the model', () => {
    expect(resin({ supportsAndWastePercent: { resin: 200, filament: 0 }, resinPerPartMl: 5 })?.minutes).toBe(resin({})?.minutes)
  })

  it('prints the filament allowance in the time too', () => {
    expect(filament({ supportsAndWastePercent: { resin: 0, filament: 200 } })!.minutes!).toBeGreaterThan(filament({})!.minutes!)
  })

  it('reaches an automatic estimate a print carries', () => {
    const fields = automaticEstimateFields({ modelVolumeMm3: 10_000 }, 'resin', defaults)
    expect(requestPrintEstimate({ printType: 'resin', ...fields })?.material).toBeCloseTo(17)
  })

  it('keeps an adjusted material as the admin entered it', () => {
    const fields = automaticEstimateFields({ modelVolumeMm3: 10_000 }, 'resin', defaults)
    expect(requestPrintEstimate({ printType: 'resin', ...fields, estimatedMaterialOverride: 12 })?.material).toBe(12)
  })
})

describe('filament slicer profile', () => {
  // A 20 mm cube: 8,000 mm³ inside 2,400 mm² of surface.
  const cube = (settings: Partial<MaterialEstimateSettings>) =>
    automaticPrintEstimate(
      { printType: 'filament', modelVolumeMm3: 8_000, modelSurfaceAreaMm2: 2_400, modelHeightMm: 20 },
      { ...exact, ...settings },
    )?.material

  it('builds the shell from the wall count at a 0.45 mm line width', () => {
    // Two walls make a 0.9 mm shell of 2,160 mm³, the rest left hollow.
    expect(cube({ filamentWalls: 2, filamentInfillPercent: 0 })).toBeCloseTo(2.16 * 1.24)
  })

  it('fills the interior at the infill percentage', () => {
    // 5% of the 5,840 mm³ left inside two walls is 292 mm³.
    expect(cube({ filamentWalls: 2, filamentInfillPercent: 5 })).toBeCloseTo((2.16 + 0.292) * 1.24)
  })

  it('fills a model thinner than its walls solid', () => {
    expect(cube({ filamentWalls: 20, filamentInfillPercent: 0 })).toBeCloseTo(8 * 1.24)
  })
})

describe('material estimate settings', () => {
  it('accepts the defaults', () => {
    expect(validMaterialEstimateSettings(defaults)).toBe(true)
  })

  it('accepts an allowance of 200%', () => {
    expect(validMaterialEstimateSettings({ ...defaults, supportsAndWastePercent: { resin: 200, filament: 0 } })).toBe(true)
  })

  it('rejects an allowance above 200%', () => {
    expect(validMaterialEstimateSettings({ ...defaults, supportsAndWastePercent: { resin: 30, filament: 201 } })).toBe(false)
  })

  it('rejects a negative allowance', () => {
    expect(validMaterialEstimateSettings({ ...defaults, supportsAndWastePercent: { resin: -1, filament: 10 } })).toBe(false)
  })

  it('rejects a negative resin amount per part', () => {
    expect(validMaterialEstimateSettings({ ...defaults, resinPerPartMl: -0.1 })).toBe(false)
  })

  it('rejects a resin amount per part above 100 mL', () => {
    expect(validMaterialEstimateSettings({ ...defaults, resinPerPartMl: 101 })).toBe(false)
  })

  it('rejects infill above 100%', () => {
    expect(validMaterialEstimateSettings({ ...defaults, filamentInfillPercent: 101 })).toBe(false)
  })

  it('rejects a print without walls', () => {
    expect(validMaterialEstimateSettings({ ...defaults, filamentWalls: 0 })).toBe(false)
  })

  it('rejects part of a wall', () => {
    expect(validMaterialEstimateSettings({ ...defaults, filamentWalls: 2.5 })).toBe(false)
  })

  it('rejects more than 20 walls', () => {
    expect(validMaterialEstimateSettings({ ...defaults, filamentWalls: 21 })).toBe(false)
  })

  it('defaults resin to a 60% allowance', () => {
    expect(defaults.supportsAndWastePercent.resin).toBe(60)
  })

  it('defaults resin to 1 mL per part', () => {
    expect(defaults.resinPerPartMl).toBe(1)
  })

  it('defaults filament to a 25% allowance', () => {
    expect(defaults.supportsAndWastePercent.filament).toBe(25)
  })
})
