import { describe, expect, it } from 'vitest'
import {
  ORIENTATION_ANALYSIS_VERSION,
  candidateFitsPrinter,
  normalizePrinterProfile,
  orientationAnalysisReady,
  packPlate,
  placementIssues,
  planPlates,
  type PlateCandidate,
  type PrinterProfile,
} from './platePlanner'

const printer: PrinterProfile = {
  id: 'test',
  name: 'Test printer',
  printType: 'resin',
  enabled: true,
  widthMm: 100,
  depthMm: 60,
  heightMm: 150,
  spacingMm: 2,
  supportMarginMm: 0,
  adhesionMarginMm: 0,
  heightAllowanceMm: 0,
  maxHeightDifferenceMm: 20,
}

const candidate = (copyId: string, widthMm: number, depthMm: number, height = 30): PlateCandidate => ({
  copyId,
  requestId: copyId.split(':')[0] ?? copyId,
  name: copyId,
  footprint: { widthMm, depthMm, known: true },
  estimatedSupportedHeightMm: height,
})

describe('plate planner', () => {
  it('accepts completed analysis from the current shared orientation version', () => {
    expect(
      orientationAnalysisReady({
        requestId: 'model',
        analysisVersion: ORIENTATION_ANALYSIS_VERSION,
        widthMm: 10,
        depthMm: 10,
        heightMm: 10,
        orientationCandidates: [{} as never],
      }),
    ).toBe(true)
  })

  it('packs copy-level quantities and rotates models to fit', () => {
    const result = packPlate([candidate('a:1', 55, 80), candidate('a:2', 20, 20)], printer)
    expect(result.placements.map((placement) => placement.copyId)).toContain('a:1')
    expect(result.placements.some((placement) => placement.rotationZDegrees === 90)).toBe(true)
    expect(new Set(result.placements.map((placement) => placement.copyId)).size).toBe(result.placements.length)
  })

  it('detects overlaps, spacing violations, and plate bounds', () => {
    const base = candidate('a:1', 20, 20)
    const issues = placementIssues(
      [
        { ...base, xMm: 10, yMm: 10, rotationZDegrees: 0 },
        { ...candidate('b:1', 20, 20), xMm: 25, yMm: 10, rotationZDegrees: 0 },
        { ...candidate('c:1', 10, 10), xMm: 98, yMm: 55, rotationZDegrees: 0 },
      ],
      printer,
    )
    expect(issues.get('a:1')).toContain('overlap')
    expect(issues.get('b:1')).toContain('overlap')
    expect(issues.get('c:1')).toContain('out-of-bounds')

    const spacing = placementIssues(
      [
        { ...base, xMm: 10, yMm: 10, rotationZDegrees: 0 },
        { ...candidate('b:1', 20, 20), xMm: 31, yMm: 10, rotationZDegrees: 0 },
      ],
      printer,
    )
    expect(spacing.get('a:1')).toContain('spacing')
  })

  it('accepts exact spacing despite floating-point rounding', () => {
    const first = { ...candidate('a:1', 20, 20), xMm: 16, yMm: 16, rotationZDegrees: 0 }
    const second = { ...candidate('b:1', 20, 20), xMm: 48.99999999999999, yMm: 16, rotationZDegrees: 0 }

    expect(placementIssues([first, second], printer).size).toBe(0)
  })

  it('adds support and adhesion margins to the packing footprint', () => {
    const expanded = { ...printer, supportMarginMm: 4, adhesionMarginMm: 2 }
    const result = packPlate([candidate('a:1', 40, 40), candidate('b:1', 40, 40)], expanded)
    expect(result.placements).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
  })

  it('rejects models whose estimated supported height exceeds the build volume', () => {
    const result = packPlate([candidate('a:1', 20, 20, 151)], printer)
    expect(result.placements).toEqual([])
    expect(result.skipped.map((entry) => entry.copyId)).toEqual(['a:1'])
  })

  it('recognizes models that only fit after rotating the footprint', () => {
    expect(candidateFitsPrinter(candidate('a:1', 55, 80), printer)).toBe(true)
  })

  it('starts with height groups and then fills the taller plate with a shorter model', () => {
    const result = packPlate([candidate('short:1', 40, 40, 20), candidate('short:2', 40, 40, 25), candidate('tall:1', 40, 40, 80)], printer)
    expect(result.placements.map((placement) => placement.copyId)).toEqual(expect.arrayContaining(['tall:1', 'short:1']))
    expect(result.skipped.map((entry) => entry.copyId)).toEqual(['short:2'])
  })

  it('plans every packable backlog copy across multiple plates', () => {
    const candidates = Array.from({ length: 7 }, (_, index) => candidate(`model:${index + 1}`, 40, 40))
    const result = planPlates(candidates, printer)
    expect(result.plates.length).toBeGreaterThan(1)
    expect(
      result.plates
        .flat()
        .map((placement) => placement.copyId)
        .sort(),
    ).toEqual(candidates.map((entry) => entry.copyId).sort())
    expect(result.skipped).toEqual([])
    for (const plate of result.plates) expect(placementIssues(plate, printer).size).toBe(0)
  })

  it('continues planning incompatible height bands on later plates', () => {
    const result = planPlates(
      [candidate('short:1', 40, 40, 20), candidate('short:2', 40, 40, 25), candidate('tall:1', 40, 40, 80)],
      printer,
    )
    expect(result.plates.flat().map((placement) => placement.copyId)).toEqual(expect.arrayContaining(['short:1', 'short:2', 'tall:1']))
    expect(result.plates.some((plate) => plate.some((entry) => entry.copyId === 'tall:1'))).toBe(true)
    expect(result.plates[0]?.some((entry) => entry.copyId === 'tall:1')).toBe(true)
  })

  it('consolidates sparse tail plates even when their heights differ', () => {
    const resinPrinter = {
      ...printer,
      widthMm: 129,
      depthMm: 80,
      spacingMm: 5,
      supportMarginMm: 4,
      adhesionMarginMm: 2,
    }
    const result = planPlates(
      [
        candidate('tall:1', 56.65048352408666, 64.18009287429979, 63.52432411055692),
        candidate('short:1', 34.60187949413539, 23.31624156113429, 33.55453880647142),
      ],
      resinPrinter,
    )

    expect(result.plates).toHaveLength(1)
    expect(result.plates[0]?.map((placement) => placement.copyId)).toEqual(expect.arrayContaining(['tall:1', 'short:1']))
    expect(placementIssues(result.plates[0] ?? [], resinPrinter).size).toBe(0)
  })

  it('fills taller plates with individual shorter models before adding more plates', () => {
    const result = planPlates(
      [
        candidate('tall:1', 60, 60, 80),
        candidate('short:1', 35, 28, 20),
        candidate('short:2', 35, 28, 20),
        candidate('short:3', 35, 28, 20),
      ],
      printer,
    )

    expect(result.plates).toHaveLength(2)
    expect(result.plates[0]?.some((placement) => placement.copyId === 'tall:1')).toBe(true)
    expect(result.plates[0]?.filter((placement) => placement.copyId.startsWith('short:')).length).toBeGreaterThan(0)
    expect(result.plates[1]?.length).toBeLessThan(3)
    for (const plate of result.plates) expect(placementIssues(plate, printer).size).toBe(0)
  })

  it('never emits invalid placements across varied decimal footprints', () => {
    let state = 42
    const random = () => (state = (state * 1_664_525 + 1_013_904_223) >>> 0) / 2 ** 32
    const candidates = Array.from({ length: 120 }, (_, index) =>
      candidate(`random:${index}`, 5 + random() * 50, 5 + random() * 50, 10 + random() * 130),
    )
    const result = planPlates(candidates, { ...printer, widthMm: 129, depthMm: 80, supportMarginMm: 4, adhesionMarginMm: 2 })
    for (const plate of result.plates)
      expect(placementIssues(plate, { ...printer, widthMm: 129, depthMm: 80, supportMarginMm: 4, adhesionMarginMm: 2 })).toEqual(new Map())
  })

  it('uses filament brim margin without resin support allowances', () => {
    const filament: PrinterProfile = {
      id: 'filament',
      name: 'Filament',
      printType: 'filament',
      enabled: true,
      widthMm: 100,
      depthMm: 100,
      heightMm: 100,
      spacingMm: 2,
      brimMarginMm: 5,
      filamentDiameterMm: 1.75,
      materialDensityGPerCm3: 1.24,
    }
    expect(candidateFitsPrinter(candidate('fits', 90, 90, 100), filament)).toBe(true)
    expect(candidateFitsPrinter(candidate('too-wide', 91, 90, 100), filament)).toBe(false)
  })

  it('does not split filament plates into resin height bands', () => {
    const filament: PrinterProfile = {
      id: 'filament',
      name: 'Filament',
      printType: 'filament',
      enabled: true,
      widthMm: 100,
      depthMm: 100,
      heightMm: 100,
      spacingMm: 0,
      brimMarginMm: 0,
      filamentDiameterMm: 1.75,
      materialDensityGPerCm3: 1.24,
    }
    const result = planPlates([candidate('short', 40, 40, 10), candidate('tall', 40, 40, 90)], filament)
    expect(result.plates).toHaveLength(1)
  })

  it('normalizes legacy profiles to resin without changing their build volume', () => {
    expect(normalizePrinterProfile({ id: 'legacy', name: 'Legacy', widthMm: 130, depthMm: 80, heightMm: 160 })).toMatchObject({
      printType: 'resin',
      enabled: true,
      widthMm: 130,
      depthMm: 80,
      heightMm: 160,
    })
  })
})
