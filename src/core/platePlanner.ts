import { MaxRectsPacker, PACKING_LOGIC, Rectangle } from 'maxrects-packer'
import { BALANCED_PLANNING_WEIGHTS, PLATE_PLANNING_STRATEGIES, type PlatePlanningStrategy } from './planningStrategy'

export { BALANCED_PLANNING_WEIGHTS, PLATE_PLANNING_STRATEGIES, type PlatePlanningStrategy } from './planningStrategy'

export const ORIENTATION_ANALYSIS_VERSION = 8

type BasePrinterProfile = {
  id: string
  name: string
  printType: 'resin' | 'filament'
  enabled: boolean
  widthMm: number
  depthMm: number
  heightMm: number
  spacingMm: number
}

export type ResinPrinterProfile = BasePrinterProfile & {
  printType: 'resin'
  supportMarginMm: number
  adhesionMarginMm: number
  heightAllowanceMm: number
  maxHeightDifferenceMm: number
}

export type FilamentPrinterProfile = BasePrinterProfile & {
  printType: 'filament'
  brimMarginMm: number
  filamentDiameterMm: number
  materialDensityGPerCm3: number
}

export type PrinterProfile = ResinPrinterProfile | FilamentPrinterProfile

export type PlateCandidate = {
  copyId: string
  requestId: string
  name: string
  requesterId?: string
  userQueuePosition?: number
  queuedAt?: number
  footprint: { widthMm: number; depthMm: number; known: boolean }
  estimatedSupportedHeightMm: number
  orientationQuaternion?: [number, number, number, number]
  orientationIslandCount?: number
  orientationRisk?: number
}

export type PlatePlacement = PlateCandidate & {
  xMm: number
  yMm: number
  rotationZDegrees: number
}

export type PlatePlan = {
  plates: PlatePlacement[][]
  skipped: PlateCandidate[]
  constraintIssue?: 'required-copies-unavailable' | 'required-copies-incompatible' | 'required-copies-do-not-fit'
}

export type FleetCandidate = {
  copyId: string
  candidatesByPrinterId: Record<string, PlateCandidate>
}

export type PlateModelAnalysis = {
  requestId: string
  contentHash?: string
  analysisVersion?: number
  widthMm: number
  depthMm: number
  heightMm: number
  estimatedVolumeMm3?: number
  orientationQuaternion?: [number, number, number, number]
  orientationIslandCount?: number
  orientationRisk?: number
  orientationCandidates?: import('./mesh/resinOrientation').ResinOrientation[]
}

export function orientationAnalysisReady(
  analysis?: PlateModelAnalysis,
): analysis is PlateModelAnalysis & { orientationCandidates: import('./mesh/resinOrientation').ResinOrientation[] } {
  return analysis?.analysisVersion === ORIENTATION_ANALYSIS_VERSION && !!analysis.orientationCandidates?.length
}

export function modelAnalysisReady(analysis?: PlateModelAnalysis): analysis is PlateModelAnalysis {
  return analysis?.analysisVersion === ORIENTATION_ANALYSIS_VERSION && analysis.widthMm > 0 && analysis.depthMm > 0 && analysis.heightMm > 0
}

export type OrientationAnalysisJob = {
  requestId: string
  status: 'pending' | 'running' | 'ready' | 'failed'
  analysisVersion: number
  error?: string
  queuedAt: number
  startedAt?: number
  finishedAt?: number
}

export type PlatePlannerDraft = {
  fingerprint: string
  printerId: string
  candidates: PlateCandidate[]
  placements: PlatePlacement[]
  plates?: PlatePlacement[][]
  skippedCount: number
  savedAt: number
}

export type PlacementIssue = 'overlap' | 'spacing' | 'out-of-bounds'

const PLACEMENT_EPSILON_MM = 1e-6

export function placementDimensions(placement: Pick<PlatePlacement, 'footprint' | 'rotationZDegrees'>, printer?: PrinterProfile) {
  const quarterTurn = Math.abs(Math.round(placement.rotationZDegrees / 90)) % 2 === 1
  const footprint = quarterTurn ? { widthMm: placement.footprint.depthMm, depthMm: placement.footprint.widthMm } : placement.footprint
  const margin = printer ? planningMarginMm(printer) : 0
  return { widthMm: footprint.widthMm + margin * 2, depthMm: footprint.depthMm + margin * 2 }
}

export function candidateFitsPrinter(candidate: PlateCandidate, printer: PrinterProfile) {
  const size = placementDimensions({ ...candidate, rotationZDegrees: 0 }, printer)
  const fitsFlat = size.widthMm <= printer.widthMm && size.depthMm <= printer.depthMm
  const fitsRotated = size.depthMm <= printer.widthMm && size.widthMm <= printer.depthMm
  return candidate.estimatedSupportedHeightMm <= printer.heightMm && (fitsFlat || fitsRotated)
}

export function analysisFitsPrinter(analysis: PlateModelAnalysis, printer: PrinterProfile) {
  if (!modelAnalysisReady(analysis)) return false
  if (printer.printType === 'filament') {
    return candidateFitsPrinter(
      {
        copyId: 'fit-check',
        requestId: analysis.requestId,
        name: 'Fit check',
        footprint: { widthMm: analysis.widthMm, depthMm: analysis.depthMm, known: true },
        estimatedSupportedHeightMm: analysis.heightMm,
      },
      printer,
    )
  }
  return (
    analysis.orientationCandidates?.some((orientation) =>
      candidateFitsPrinter(
        {
          copyId: 'fit-check',
          requestId: analysis.requestId,
          name: 'Fit check',
          footprint: { widthMm: orientation.widthMm, depthMm: orientation.depthMm, known: true },
          estimatedSupportedHeightMm: orientation.heightMm + printer.heightAllowanceMm,
        },
        printer,
      ),
    ) ?? false
  )
}

function bounds(placement: PlatePlacement, printer: PrinterProfile, padding = 0) {
  const size = placementDimensions(placement, printer)
  return {
    left: placement.xMm - size.widthMm / 2 - padding,
    right: placement.xMm + size.widthMm / 2 + padding,
    top: placement.yMm - size.depthMm / 2 - padding,
    bottom: placement.yMm + size.depthMm / 2 + padding,
  }
}

function intersects(first: ReturnType<typeof bounds>, second: ReturnType<typeof bounds>) {
  return (
    first.left < second.right - PLACEMENT_EPSILON_MM &&
    first.right > second.left + PLACEMENT_EPSILON_MM &&
    first.top < second.bottom - PLACEMENT_EPSILON_MM &&
    first.bottom > second.top + PLACEMENT_EPSILON_MM
  )
}

export function placementIssues(placements: PlatePlacement[], printer: PrinterProfile) {
  const issues = new Map<string, Set<PlacementIssue>>()
  const add = (copyId: string, issue: PlacementIssue) => {
    const current = issues.get(copyId) ?? new Set<PlacementIssue>()
    current.add(issue)
    issues.set(copyId, current)
  }

  for (const placement of placements) {
    const box = bounds(placement, printer)
    if (
      box.left < -PLACEMENT_EPSILON_MM ||
      box.top < -PLACEMENT_EPSILON_MM ||
      box.right > printer.widthMm + PLACEMENT_EPSILON_MM ||
      box.bottom > printer.depthMm + PLACEMENT_EPSILON_MM ||
      placement.estimatedSupportedHeightMm > printer.heightMm + PLACEMENT_EPSILON_MM
    ) {
      add(placement.copyId, 'out-of-bounds')
    }
  }

  for (let firstIndex = 0; firstIndex < placements.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < placements.length; secondIndex++) {
      const first = placements[firstIndex]
      const second = placements[secondIndex]
      if (!first || !second) continue
      if (intersects(bounds(first, printer), bounds(second, printer))) {
        add(first.copyId, 'overlap')
        add(second.copyId, 'overlap')
      } else if (intersects(bounds(first, printer, printer.spacingMm / 2), bounds(second, printer, printer.spacingMm / 2))) {
        add(first.copyId, 'spacing')
        add(second.copyId, 'spacing')
      }
    }
  }
  return issues
}

export function packPlate(candidates: PlateCandidate[], printer: PrinterProfile) {
  const plan = planPlates(candidates, printer)
  const placements = plan.plates[0] ?? []
  const placedIds = new Set(placements.map((placement) => placement.copyId))
  return { placements, skipped: candidates.filter((candidate) => !placedIds.has(candidate.copyId)) }
}

export function planPlates(
  candidates: PlateCandidate[],
  printer: PrinterProfile,
  strategy: PlatePlanningStrategy = 'balanced',
  requiredCopyIds: string[] = [],
): PlatePlan {
  const requiredIds = [...new Set(requiredCopyIds)]
  if (requiredIds.length) {
    const required = requiredIds.flatMap((copyId) => candidates.find((candidate) => candidate.copyId === copyId) ?? [])
    if (required.length !== requiredIds.length) return { plates: [], skipped: [], constraintIssue: 'required-copies-unavailable' }
    if (required.some((candidate) => !candidateFitsPrinter(candidate, printer))) {
      return { plates: [], skipped: [], constraintIssue: 'required-copies-incompatible' }
    }
    if (printer.printType === 'resin' && heightRange(required) > printer.maxHeightDifferenceMm) {
      return { plates: [], skipped: [], constraintIssue: 'required-copies-incompatible' }
    }
    if (packGeometry(required, printer).length !== 1) {
      return { plates: [], skipped: [], constraintIssue: 'required-copies-do-not-fit' }
    }

    const requiredIdSet = new Set(requiredIds)
    const companions = orderCandidates(
      candidates.filter(
        (candidate) =>
          !requiredIdSet.has(candidate.copyId) &&
          candidateFitsPrinter(candidate, printer) &&
          (printer.printType !== 'resin' || heightRange([...required, candidate]) <= printer.maxHeightDifferenceMm),
      ),
      printer,
      strategy,
    )
    const requiredPlateCandidates = [...required]
    for (const companion of companions) {
      if (packGeometry([...requiredPlateCandidates, companion], printer).length === 1) requiredPlateCandidates.push(companion)
    }
    const requiredPlate = packGeometry(requiredPlateCandidates, printer)[0] ?? []
    const placedIds = new Set(requiredPlate.map((placement) => placement.copyId))
    const remaining = candidates.filter((candidate) => !placedIds.has(candidate.copyId))
    const rest = planPlates(remaining, printer, strategy)
    return { plates: [requiredPlate, ...rest.plates], skipped: rest.skipped }
  }

  const plans = (strategy === 'utilization' ? PLATE_PLANNING_STRATEGIES : [strategy]).map((candidateStrategy) =>
    buildPlatePlan(candidates, printer, candidateStrategy),
  )
  const best = plans.reduce((current, candidate) =>
    comparePlatePlans(candidate.plates, current.plates, printer) < 0 ? candidate : current,
  )
  return { plates: orderPlates(best.plates, printer, strategy), skipped: best.skipped }
}

function buildPlatePlan(candidates: PlateCandidate[], printer: PrinterProfile, strategy: PlatePlanningStrategy) {
  const plates: PlatePlacement[][] = []
  const skipped: PlateCandidate[] = []
  let remaining = orderCandidates(candidates, printer, strategy)

  while (remaining.length) {
    const compatible = printer.printType === 'resin' ? heightBand(remaining, printer, strategy) : remaining
    const compatibleIds = new Set(compatible.map((candidate) => candidate.copyId))
    const packable: PlateCandidate[] = []
    for (const candidate of compatible) {
      if (candidateFitsPrinter(candidate, printer)) packable.push(candidate)
      else skipped.push(candidate)
    }
    remaining = remaining.filter((candidate) => !compatibleIds.has(candidate.copyId))
    if (!packable.length) continue

    plates.push(...packGeometry(packable, printer))
  }
  const ordered = printer.printType === 'resin' ? orderResinPlates(plates, printer) : plates
  const filled = printer.printType === 'resin' ? backfillShorterModels(ordered, printer) : ordered
  const consolidated = consolidatePlates(filled, printer)
  return { plates: consolidated, skipped }
}

function comparePlatePlans(first: PlatePlacement[][], second: PlatePlacement[][], printer: PrinterProfile) {
  const plateDifference = first.length - second.length
  if (plateDifference) return plateDifference
  const firstSparsest = sparsestPlateArea(first, printer)
  const secondSparsest = sparsestPlateArea(second, printer)
  return secondSparsest - firstSparsest
}

function sparsestPlateArea(plates: PlatePlacement[][], printer: PrinterProfile) {
  return plates.length ? Math.min(...plates.map((plate) => occupiedArea(plate, printer))) : 0
}

function heightRange(candidates: PlateCandidate[]) {
  const heights = candidates.map((candidate) => candidate.estimatedSupportedHeightMm)
  return Math.max(...heights) - Math.min(...heights)
}

function orderCandidates(candidates: PlateCandidate[], printer: PrinterProfile, strategy: PlatePlanningStrategy) {
  if (strategy === 'balanced') return orderBalancedCandidates(candidates, printer)
  return [...candidates].sort((first, second) => {
    if (strategy === 'height-first') return second.estimatedSupportedHeightMm - first.estimatedSupportedHeightMm
    if (strategy === 'utilization') return candidateArea(second, printer) - candidateArea(first, printer)
    if (strategy === 'oldest-first') return compareOldest(first, second)
    return compareUserPriority(first, second)
  })
}

function orderBalancedCandidates(candidates: PlateCandidate[], printer: PrinterProfile) {
  const priorityScores = normalizedRankScores(candidates, compareUserPriorityValue)
  const utilizationScores = normalizedRankScores(
    candidates,
    (first, second) => candidateArea(second, printer) - candidateArea(first, printer),
  )
  const compatibleAreas =
    printer.printType === 'resin'
      ? new Map(candidates.map((candidate) => [candidate, compatibleHeightArea(candidate, candidates, printer)]))
      : undefined
  const heightScores =
    compatibleAreas !== undefined
      ? normalizedRankScores(candidates, (first, second) => (compatibleAreas.get(second) ?? 0) - (compatibleAreas.get(first) ?? 0))
      : undefined
  return [...candidates].sort((first, second) => {
    const scoreDifference =
      balancedScore(priorityScores.get(second) ?? 0, utilizationScores.get(second) ?? 0, heightScores?.get(second)) -
      balancedScore(priorityScores.get(first) ?? 0, utilizationScores.get(first) ?? 0, heightScores?.get(first))
    return scoreDifference || compareUserPriority(first, second)
  })
}

function heightBand(candidates: PlateCandidate[], printer: ResinPrinterProfile, strategy: PlatePlanningStrategy) {
  if (strategy === 'utilization') return candidates
  if (strategy === 'height-first') {
    const tallest = Math.max(...candidates.map((candidate) => candidate.estimatedSupportedHeightMm))
    return candidates.filter((candidate) => tallest - candidate.estimatedSupportedHeightMm <= printer.maxHeightDifferenceMm)
  }
  const priority = candidates[0]
  if (!priority) return candidates
  return candidates.filter(
    (candidate) => Math.abs(candidate.estimatedSupportedHeightMm - priority.estimatedSupportedHeightMm) <= printer.maxHeightDifferenceMm,
  )
}

function packGeometry(candidates: PlateCandidate[], printer: PrinterProfile) {
  const plans = [
    packGeometryWithLogic(candidates, printer, PACKING_LOGIC.MAX_EDGE),
    packGeometryWithLogic(candidates, printer, PACKING_LOGIC.MAX_AREA),
  ]
  return plans.reduce((best, plan) => (comparePlatePlans(plan, best, printer) < 0 ? plan : best))
}

export function allocateFleetCandidates(candidates: FleetCandidate[], printers: PrinterProfile[]) {
  const enabled = printers.filter((printer) => printer.enabled)
  const printersById = new Map(enabled.map((printer) => [printer.id, printer]))
  const assignments = new Map(enabled.map((printer) => [printer.id, [] as PlateCandidate[]]))
  const load = new Map(enabled.map((printer) => [printer.id, 0]))
  const ordered = [...candidates].sort((first, second) => {
    const compatibleDifference = compatiblePrinterIds(first, printersById).length - compatiblePrinterIds(second, printersById).length
    if (compatibleDifference) return compatibleDifference
    return largestCandidateArea(second) - largestCandidateArea(first)
  })

  for (const fleetCandidate of ordered) {
    const compatible = compatiblePrinterIds(fleetCandidate, printersById)
      .map((printerId) => printersById.get(printerId)!)
      .sort((first, second) => {
        const loadDifference = (load.get(first.id) ?? 0) - (load.get(second.id) ?? 0)
        if (Math.abs(loadDifference) > PLACEMENT_EPSILON_MM) return loadDifference
        return first.widthMm * first.depthMm - second.widthMm * second.depthMm
      })
    const printer = compatible[0]
    if (!printer) continue
    const candidate = fleetCandidate.candidatesByPrinterId[printer.id]
    assignments.get(printer.id)!.push(candidate)
    load.set(printer.id, (load.get(printer.id) ?? 0) + candidateArea(candidate, printer) / (printer.widthMm * printer.depthMm))
  }

  return assignments
}

function compatiblePrinterIds(candidate: FleetCandidate, printersById: Map<string, PrinterProfile>) {
  return Object.keys(candidate.candidatesByPrinterId).filter((printerId) => printersById.has(printerId))
}

function largestCandidateArea(candidate: FleetCandidate) {
  return Math.max(0, ...Object.values(candidate.candidatesByPrinterId).map(({ footprint }) => footprint.widthMm * footprint.depthMm))
}

function packGeometryWithLogic(candidates: PlateCandidate[], printer: PrinterProfile, logic: PACKING_LOGIC) {
  const packer = new MaxRectsPacker(printer.widthMm, printer.depthMm, printer.spacingMm, {
    smart: false,
    pot: false,
    square: false,
    allowRotation: true,
    border: 0,
    logic,
  })
  const rectangles: Rectangle[] = []
  for (const candidate of candidates) {
    const size = placementDimensions({ ...candidate, rotationZDegrees: 0 }, printer)
    const mustRotate = size.widthMm > printer.widthMm || size.depthMm > printer.depthMm
    const rectangle = new Rectangle(
      mustRotate ? size.depthMm : size.widthMm,
      mustRotate ? size.widthMm : size.depthMm,
      0,
      0,
      false,
      !mustRotate,
    )
    rectangle.data = { candidate, preRotated: mustRotate }
    rectangles.push(rectangle)
  }
  packer.addArray(rectangles)
  return packer.bins.flatMap((bin) => {
    const placements = bin.rects.map((rectangle) => {
      const { candidate, preRotated } = rectangle.data as { candidate: PlateCandidate; preRotated: boolean }
      const unrotated = placementDimensions({ ...candidate, rotationZDegrees: 0 }, printer)
      const rotationZDegrees =
        preRotated || (approximately(rectangle.width, unrotated.depthMm) && approximately(rectangle.height, unrotated.widthMm)) ? 90 : 0
      return {
        ...candidate,
        xMm: rectangle.x + rectangle.width / 2,
        yMm: rectangle.y + rectangle.height / 2,
        rotationZDegrees,
      } satisfies PlatePlacement
    })
    return placements.length ? [placements] : []
  })
}

function consolidatePlates(plates: PlatePlacement[][], printer: PrinterProfile) {
  const consolidated = [...plates]
  let merged = true
  while (merged) {
    merged = false
    for (let sourceIndex = consolidated.length - 1; sourceIndex > 0 && !merged; sourceIndex--) {
      const source = consolidated[sourceIndex]
      if (!source) continue
      for (let targetIndex = sourceIndex - 1; targetIndex >= 0; targetIndex--) {
        const target = consolidated[targetIndex]
        if (!target) continue
        const packed = packGeometry([...target, ...source].map(toCandidate), printer)
        if (packed.length !== 1) continue
        consolidated[targetIndex] = packed[0]!
        consolidated.splice(sourceIndex, 1)
        merged = true
        break
      }
    }
  }
  return consolidated
}

function backfillShorterModels(plates: PlatePlacement[][], printer: PrinterProfile) {
  const filled = plates.map((plate) => [...plate])
  for (let targetIndex = 0; targetIndex < filled.length - 1; targetIndex++) {
    const target = filled[targetIndex]
    if (!target) continue
    const targetHeight = tallestModel(target)
    for (let sourceIndex = targetIndex + 1; sourceIndex < filled.length; sourceIndex++) {
      const source = filled[sourceIndex]
      if (!source?.length) continue
      const shorter = [...source]
        .filter((placement) => placement.estimatedSupportedHeightMm <= targetHeight + PLACEMENT_EPSILON_MM)
        .sort((first, second) => candidateArea(first, printer) - candidateArea(second, printer))
      for (const candidate of shorter) {
        const packed = packGeometry([...target, candidate].map(toCandidate), printer)
        if (packed.length !== 1) continue
        filled[targetIndex] = packed[0]!
        target.splice(0, target.length, ...packed[0])
        const candidateIndex = source.findIndex((placement) => placement.copyId === candidate.copyId)
        if (candidateIndex >= 0) source.splice(candidateIndex, 1)
      }
    }
  }
  return filled.filter((plate) => plate.length)
}

function orderPlates(plates: PlatePlacement[][], printer: PrinterProfile, strategy: PlatePlanningStrategy) {
  if (strategy === 'balanced') return orderBalancedPlates(plates, printer)
  return [...plates].sort((first, second) => {
    if (strategy === 'height-first') return tallestModel(second) - tallestModel(first)
    if (strategy === 'utilization') return occupiedArea(second, printer) - occupiedArea(first, printer)
    if (strategy === 'oldest-first') return compareOldest(bestOldest(first), bestOldest(second))
    return compareUserPriority(bestPriority(first), bestPriority(second))
  })
}

function orderBalancedPlates(plates: PlatePlacement[][], printer: PrinterProfile) {
  const priorityScores = normalizedRankScores(plates, (first, second) =>
    compareUserPriorityValue(bestPriority(first), bestPriority(second)),
  )
  const utilizationScores = normalizedRankScores(plates, (first, second) => occupiedArea(second, printer) - occupiedArea(first, printer))
  const heightScores =
    printer.printType === 'resin'
      ? normalizedRankScores(plates, (first, second) => plateHeightEfficiency(second, printer) - plateHeightEfficiency(first, printer))
      : undefined
  return [...plates].sort((first, second) => {
    const scoreDifference =
      balancedScore(priorityScores.get(second) ?? 0, utilizationScores.get(second) ?? 0, heightScores?.get(second)) -
      balancedScore(priorityScores.get(first) ?? 0, utilizationScores.get(first) ?? 0, heightScores?.get(first))
    return scoreDifference || compareUserPriority(bestPriority(first), bestPriority(second))
  })
}

function orderResinPlates(plates: PlatePlacement[][], printer: PrinterProfile) {
  return [...plates].sort((first, second) => compareResinPlates(first, second, printer))
}

function compareResinPlates(first: PlatePlacement[], second: PlatePlacement[], printer: PrinterProfile) {
  const heightDifference = tallestModel(second) - tallestModel(first)
  if (Math.abs(heightDifference) > PLACEMENT_EPSILON_MM) return heightDifference
  return occupiedArea(second, printer) - occupiedArea(first, printer)
}

function bestPriority(plate: PlatePlacement[]) {
  return [...plate].sort(compareUserPriority)[0]
}

function compareUserPriority(first: PlateCandidate, second: PlateCandidate) {
  return (
    compareUserPriorityValue(first, second) ||
    (first.requesterId ?? '').localeCompare(second.requesterId ?? '') ||
    first.copyId.localeCompare(second.copyId)
  )
}

function compareUserPriorityValue(first: PlateCandidate, second: PlateCandidate) {
  const position = (first.userQueuePosition ?? Number.POSITIVE_INFINITY) - (second.userQueuePosition ?? Number.POSITIVE_INFINITY)
  if (position) return position
  const queuedAt = (first.queuedAt ?? Number.POSITIVE_INFINITY) - (second.queuedAt ?? Number.POSITIVE_INFINITY)
  return queuedAt || 0
}

function bestOldest(plate: PlatePlacement[]) {
  return [...plate].sort(compareOldest)[0]
}

function compareOldest(first: PlateCandidate, second: PlateCandidate) {
  return (
    (first.queuedAt ?? Number.POSITIVE_INFINITY) - (second.queuedAt ?? Number.POSITIVE_INFINITY) ||
    first.copyId.localeCompare(second.copyId)
  )
}

function tallestModel(plate: PlatePlacement[]) {
  return Math.max(...plate.map((placement) => placement.estimatedSupportedHeightMm))
}

function occupiedArea(plate: PlatePlacement[], printer: PrinterProfile) {
  return plate.reduce((total, placement) => total + candidateArea(placement, printer), 0)
}

function compatibleHeightArea(candidate: PlateCandidate, candidates: PlateCandidate[], printer: ResinPrinterProfile) {
  return candidates
    .filter((other) => Math.abs(other.estimatedSupportedHeightMm - candidate.estimatedSupportedHeightMm) <= printer.maxHeightDifferenceMm)
    .reduce((total, other) => total + candidateArea(other, printer), 0)
}

function plateHeightEfficiency(plate: PlatePlacement[], printer: ResinPrinterProfile) {
  const tallest = tallestModel(plate)
  if (!tallest) return 0
  return (
    plate.reduce((total, placement) => total + candidateArea(placement, printer) * (placement.estimatedSupportedHeightMm / tallest), 0) /
    (printer.widthMm * printer.depthMm)
  )
}

function balancedScore(userPriority: number, utilization: number, heightCompatibility?: number) {
  const heightWeight = heightCompatibility === undefined ? 0 : BALANCED_PLANNING_WEIGHTS.heightCompatibility
  const totalWeight = BALANCED_PLANNING_WEIGHTS.userPriority + BALANCED_PLANNING_WEIGHTS.utilization + heightWeight
  return (
    (userPriority * BALANCED_PLANNING_WEIGHTS.userPriority +
      utilization * BALANCED_PLANNING_WEIGHTS.utilization +
      (heightCompatibility ?? 0) * heightWeight) /
    totalWeight
  )
}

function normalizedRankScores<Item>(items: Item[], compare: (first: Item, second: Item) => number) {
  const ordered = [...items].sort(compare)
  const scores = new Map<Item, number>()
  const divisor = Math.max(ordered.length - 1, 1)
  let rank = 0
  ordered.forEach((item, index) => {
    const previous = ordered[index - 1]
    if (previous !== undefined && compare(previous, item)) rank = index
    scores.set(item, 1 - rank / divisor)
  })
  return scores
}

function candidateArea(candidate: Pick<PlateCandidate, 'footprint'>, printer: PrinterProfile) {
  const size = placementDimensions({ ...candidate, rotationZDegrees: 0 }, printer)
  return size.widthMm * size.depthMm
}

function toCandidate({ xMm: _xMm, yMm: _yMm, rotationZDegrees: _rotationZDegrees, ...candidate }: PlatePlacement): PlateCandidate {
  return candidate
}

function approximately(first: number, second: number) {
  return Math.abs(first - second) < 1e-6
}

export function normalizePrinterProfile(
  profile: Partial<PrinterProfile> & Pick<PrinterProfile, 'id' | 'name' | 'widthMm' | 'depthMm' | 'heightMm'>,
): PrinterProfile {
  const common = {
    id: profile.id,
    name: profile.name,
    printType: profile.printType ?? 'resin',
    enabled: profile.enabled ?? true,
    widthMm: profile.widthMm,
    depthMm: profile.depthMm,
    heightMm: profile.heightMm,
    spacingMm: profile.spacingMm ?? 5,
  }
  if (common.printType === 'filament') {
    const filament = profile as Partial<FilamentPrinterProfile> & { adhesionMarginMm?: number }
    return {
      ...common,
      printType: 'filament',
      brimMarginMm: filament.brimMarginMm ?? filament.adhesionMarginMm ?? 0,
      filamentDiameterMm: filament.filamentDiameterMm ?? 1.75,
      materialDensityGPerCm3: filament.materialDensityGPerCm3 ?? 1.24,
    }
  }
  const resin = profile as Partial<ResinPrinterProfile>
  return {
    ...common,
    printType: 'resin',
    supportMarginMm: resin.supportMarginMm ?? 4,
    adhesionMarginMm: resin.adhesionMarginMm ?? 2,
    heightAllowanceMm: resin.heightAllowanceMm ?? 5,
    maxHeightDifferenceMm: resin.maxHeightDifferenceMm ?? 20,
  }
}

export function planningMarginMm(printer: PrinterProfile) {
  return printer.printType === 'resin' ? printer.supportMarginMm + printer.adhesionMarginMm : printer.brimMarginMm
}
