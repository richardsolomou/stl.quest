import { describe, expect, it } from 'vitest'
import {
  ORIENTATION_ANALYSIS_VERSION,
  PLATE_PLANNING_STRATEGIES,
  allocateFleetCandidates,
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

const filamentPrinter: PrinterProfile = {
  id: 'filament',
  name: 'Filament',
  printType: 'filament',
  enabled: true,
  widthMm: 100,
  depthMm: 60,
  heightMm: 100,
  spacingMm: 0,
  brimMarginMm: 0,
  filamentDiameterMm: 1.75,
  materialDensityGPerCm3: 1.24,
}

const candidate = (
  copyId: string,
  widthMm: number,
  depthMm: number,
  height = 30,
  userQueuePosition?: number,
  requesterId = copyId.split(':')[0] ?? copyId,
  queuedAt = 0,
): PlateCandidate => ({
  copyId,
  requestId: copyId.split(':')[0] ?? copyId,
  name: copyId,
  footprint: { widthMm, depthMm, known: true },
  estimatedSupportedHeightMm: height,
  userQueuePosition,
  requesterId,
  queuedAt,
})

function generatedCandidates(seed: number, count: number) {
  let state = seed >>> 0
  const random = () => (state = (state * 1_664_525 + 1_013_904_223) >>> 0) / 2 ** 32
  return Array.from({ length: count }, (_, index) =>
    candidate(
      `generated:${index}`,
      24 + random() * 34,
      22 + random() * 28,
      [25, 60, 95, 130][index % 4] + random() * 10,
      Math.floor(index / 10),
      `user:${index % 10}`,
      count - 1 - index,
    ),
  )
}

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

  it('reserves the larger printer for models that need it', () => {
    const small = { ...printer, id: 'small', widthMm: 60, depthMm: 60 }
    const large = { ...printer, id: 'large', widthMm: 120, depthMm: 120 }
    const assignments = allocateFleetCandidates(
      [
        { copyId: 'large:1', candidatesByPrinterId: { large: candidate('large:1', 100, 100) } },
        {
          copyId: 'small:1',
          candidatesByPrinterId: { small: candidate('small:1', 30, 30), large: candidate('small:1', 30, 30) },
        },
      ],
      [small, large],
    )

    expect(assignments.get('large')?.map(({ copyId }) => copyId)).toEqual(['large:1'])
    expect(assignments.get('small')?.map(({ copyId }) => copyId)).toEqual(['small:1'])
  })

  it('shares flexible copies across compatible printers', () => {
    const first = { ...printer, id: 'first' }
    const second = { ...printer, id: 'second' }
    const assignments = allocateFleetCandidates(
      Array.from({ length: 4 }, (_, index) => ({
        copyId: `model:${index}`,
        candidatesByPrinterId: {
          first: candidate(`model:${index}`, 20, 20),
          second: candidate(`model:${index}`, 20, 20),
        },
      })),
      [first, second],
    )

    expect(assignments.get('first')).toHaveLength(2)
    expect(assignments.get('second')).toHaveLength(2)
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

  it('prints manually prioritized requests before taller resin plates', () => {
    const result = planPlates([candidate('tall:1', 100, 60, 80, 10), candidate('priority:1', 100, 60, 20, 0)], printer)

    expect(result.plates.map((plate) => plate[0]?.copyId)).toEqual(['priority:1', 'tall:1'])
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

  it('prints manually prioritized filament requests first', () => {
    const filament: PrinterProfile = {
      id: 'filament',
      name: 'Filament',
      printType: 'filament',
      enabled: true,
      widthMm: 100,
      depthMm: 60,
      heightMm: 100,
      spacingMm: 0,
      brimMarginMm: 0,
      filamentDiameterMm: 1.75,
      materialDensityGPerCm3: 1.24,
    }
    const result = planPlates([candidate('later:1', 100, 60, 30, 10), candidate('priority:1', 100, 60, 30, 0)], filament)

    expect(result.plates.map((plate) => plate[0]?.copyId)).toEqual(['priority:1', 'later:1'])
  })

  it('merges requester queues by each request position', () => {
    const result = planPlates(
      [
        candidate('alice-second:1', 100, 60, 30, 1, 'alice', 1),
        candidate('bob-first:1', 100, 60, 30, 0, 'bob', 2),
        candidate('alice-first:1', 100, 60, 30, 0, 'alice', 1),
      ],
      filamentPrinter,
      'user-priority',
    )

    expect(result.plates.map((plate) => plate[0]?.copyId)).toEqual(['alice-first:1', 'bob-first:1', 'alice-second:1'])
  })

  it('balances requester priority against plate utilization', () => {
    const candidates = [candidate('priority:1', 60, 60, 30, 0, 'alice', 1), candidate('fuller:1', 100, 60, 30, 1, 'bob', 2)]

    expect(planPlates(candidates, filamentPrinter, 'user-priority').plates[0]?.[0]?.copyId).toBe('priority:1')
    expect(planPlates(candidates, filamentPrinter, 'balanced').plates[0]?.[0]?.copyId).toBe('fuller:1')
  })

  it('balances requester priority against resin height compatibility', () => {
    const candidates = [
      candidate('priority-short:1', 60, 60, 10, 0, 'alice', 1),
      candidate('compatible-tall:1', 49, 60, 80, 1, 'bob', 2),
      candidate('compatible-tall:2', 49, 60, 82, 2, 'bob', 3),
    ]

    expect(planPlates(candidates, printer, 'user-priority').plates[0]?.some((placement) => placement.copyId === 'priority-short:1')).toBe(
      true,
    )
    expect(planPlates(candidates, printer, 'balanced').plates[0]?.some((placement) => placement.copyId.startsWith('compatible-tall'))).toBe(
      true,
    )
  })

  it('optimizes plate utilization independently from scheduling strategy', () => {
    const candidates = [
      candidate('one:1', 46, 36, 20, 0),
      candidate('two:1', 57, 46, 20, 1),
      candidate('three:1', 69, 31, 20, 2),
      candidate('four:1', 48, 49, 20, 3),
      candidate('five:1', 40, 34, 20, 4),
      candidate('six:1', 21, 44, 20, 5),
      candidate('seven:1', 73, 29, 20, 6),
    ]

    for (const strategy of PLATE_PLANNING_STRATEGIES) {
      const plates = planPlates(candidates, filamentPrinter, strategy).plates
      expect(plates).toHaveLength(3)
      expect(plates.every((plate) => placementIssues(plate, filamentPrinter).size === 0)).toBe(true)
    }
  })

  it('preserves distinct strategy tradeoffs across a hundred-item resin queue', () => {
    const densePrinter: PrinterProfile = {
      ...printer,
      widthMm: 130,
      depthMm: 80,
      spacingMm: 4,
      supportMarginMm: 2,
      adhesionMarginMm: 1,
    }
    const candidates = generatedCandidates(42, 100)
    const plans = Object.fromEntries(
      PLATE_PLANNING_STRATEGIES.map((strategy) => [strategy, planPlates(candidates, densePrinter, strategy).plates]),
    ) as Record<(typeof PLATE_PLANNING_STRATEGIES)[number], ReturnType<typeof planPlates>['plates']>

    for (const plates of Object.values(plans)) {
      expect(plates.flat()).toHaveLength(100)
      expect(new Set(plates.flat().map((placement) => placement.copyId))).toHaveLength(100)
      expect(plates.every((plate) => placementIssues(plate, densePrinter).size === 0)).toBe(true)
    }

    expect(plans.utilization).toHaveLength(31)
    expect(plans['user-priority']).toHaveLength(32)
    expect(plans.utilization.length).toBeLessThan(
      Math.min(...PLATE_PLANNING_STRATEGIES.filter((strategy) => strategy !== 'utilization').map((strategy) => plans[strategy].length)),
    )
    expect(plans['user-priority'][0]?.some((placement) => placement.userQueuePosition === 0)).toBe(true)
    expect(plans['oldest-first'][0]?.some((placement) => placement.queuedAt === 0)).toBe(true)
    expect(plans['user-priority'][0]?.some((placement) => placement.queuedAt === 0)).toBe(false)
    expect(Math.max(...(plans['height-first'][0] ?? []).map((placement) => placement.estimatedSupportedHeightMm))).toBe(
      Math.max(...candidates.map((entry) => entry.estimatedSupportedHeightMm)),
    )
    const utilizationAreas = plans.utilization.map((plate) =>
      plate.reduce((total, placement) => total + (placement.footprint.widthMm + 6) * (placement.footprint.depthMm + 6), 0),
    )
    expect(utilizationAreas[0]).toBe(Math.max(...utilizationAreas))
  })

  it('supports tallest-first plate ordering', () => {
    const candidates = [candidate('wide:1', 100, 60, 20), candidate('tall:1', 50, 60, 90)]

    expect(planPlates(candidates, filamentPrinter, 'height-first').plates[0]?.[0]?.copyId).toBe('tall:1')
  })

  it('supports strict oldest-first plate ordering', () => {
    const newer = candidate('newer:1', 100, 60, 30, 0, 'newer', 20)
    const older = candidate('older:1', 100, 60, 30, 1, 'older', 10)

    expect(planPlates([newer, older], filamentPrinter, 'oldest-first').plates.map((plate) => plate[0]?.copyId)).toEqual([
      'older:1',
      'newer:1',
    ])
  })

  it('keeps required copies together before filling by strategy', () => {
    const candidates = [
      candidate('required-a:1', 30, 60, 30, 2),
      candidate('required-b:1', 30, 60, 30, 3),
      candidate('priority:1', 40, 60, 30, 0),
      candidate('later:1', 40, 60, 30, 1),
    ]

    const result = planPlates(candidates, filamentPrinter, 'user-priority', ['required-a:1', 'required-b:1'])

    expect(result.plates[0]?.map((placement) => placement.copyId)).toEqual(['required-a:1', 'required-b:1', 'priority:1'])
  })

  it('only suggests resin companions compatible with all required copies', () => {
    const candidates = [
      candidate('required-a:1', 30, 60, 30),
      candidate('required-b:1', 30, 60, 40),
      candidate('similar:1', 36, 60, 45),
      candidate('tall:1', 36, 60, 80),
    ]

    const result = planPlates(candidates, printer, 'utilization', ['required-a:1', 'required-b:1'])

    expect(result.plates[0]?.map((placement) => placement.copyId)).toEqual(['required-a:1', 'required-b:1', 'similar:1'])
    expect(result.plates[1]?.map((placement) => placement.copyId)).toEqual(['tall:1'])
  })

  it('rejects required copies that cannot share one plate', () => {
    const candidates = [candidate('required-a:1', 60, 60), candidate('required-b:1', 60, 60), candidate('other:1', 40, 60)]

    const result = planPlates(candidates, filamentPrinter, 'balanced', ['required-a:1', 'required-b:1'])

    expect(result.constraintIssue).toBe('required-copies-do-not-fit')
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
