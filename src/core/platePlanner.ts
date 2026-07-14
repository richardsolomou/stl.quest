import { MaxRectsPacker, Rectangle } from 'maxrects-packer'

export const ORIENTATION_ANALYSIS_VERSION = 7

export type PrinterProfile = {
  id: string
  name: string
  widthMm: number
  depthMm: number
  heightMm: number
  spacingMm: number
  supportMarginMm: number
  adhesionMarginMm: number
  heightAllowanceMm: number
  maxHeightDifferenceMm: number
}

export type PlateCandidate = {
  copyId: string
  requestId: string
  name: string
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
  const margin = printer ? printer.supportMarginMm + printer.adhesionMarginMm : 0
  return { widthMm: footprint.widthMm + margin * 2, depthMm: footprint.depthMm + margin * 2 }
}

export function candidateFitsPrinter(candidate: PlateCandidate, printer: PrinterProfile) {
  const size = placementDimensions({ ...candidate, rotationZDegrees: 0 }, printer)
  const fitsFlat = size.widthMm <= printer.widthMm && size.depthMm <= printer.depthMm
  const fitsRotated = size.depthMm <= printer.widthMm && size.widthMm <= printer.depthMm
  return candidate.estimatedSupportedHeightMm <= printer.heightMm && (fitsFlat || fitsRotated)
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

export function planPlates(candidates: PlateCandidate[], printer: PrinterProfile) {
  const plates: PlatePlacement[][] = []
  const skipped: PlateCandidate[] = []
  let remaining = [...candidates]

  while (remaining.length) {
    const compatible = bestHeightBand(remaining, printer)
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
  const heightPreferred = orderPlates(plates, printer)
  const filled = backfillShorterModels(heightPreferred, printer)
  return { plates: orderPlates(consolidatePlates(filled, printer), printer), skipped }
}

function packGeometry(candidates: PlateCandidate[], printer: PrinterProfile) {
  const packer = new MaxRectsPacker(printer.widthMm, printer.depthMm, printer.spacingMm, {
    smart: false,
    pot: false,
    square: false,
    allowRotation: true,
    border: 0,
  })
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
    packer.add(rectangle)
  }
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

function orderPlates(plates: PlatePlacement[][], printer: PrinterProfile) {
  return [...plates].sort((first, second) => {
    const heightDifference = tallestModel(second) - tallestModel(first)
    if (Math.abs(heightDifference) > PLACEMENT_EPSILON_MM) return heightDifference
    return occupiedArea(second, printer) - occupiedArea(first, printer)
  })
}

function tallestModel(plate: PlatePlacement[]) {
  return Math.max(...plate.map((placement) => placement.estimatedSupportedHeightMm))
}

function occupiedArea(plate: PlatePlacement[], printer: PrinterProfile) {
  return plate.reduce((total, placement) => total + candidateArea(placement, printer), 0)
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

function bestHeightBand(candidates: PlateCandidate[], printer: PrinterProfile) {
  if (!candidates.length || printer.maxHeightDifferenceMm <= 0) return candidates
  const byHeight = [...candidates].sort((first, second) => first.estimatedSupportedHeightMm - second.estimatedSupportedHeightMm)
  let best: PlateCandidate[] = []
  let right = 0
  for (let left = 0; left < byHeight.length; left++) {
    while (
      right < byHeight.length &&
      byHeight[right].estimatedSupportedHeightMm - byHeight[left].estimatedSupportedHeightMm <= printer.maxHeightDifferenceMm
    ) {
      right++
    }
    const band = byHeight.slice(left, right)
    const bandArea = band.reduce((total, candidate) => {
      const size = placementDimensions({ ...candidate, rotationZDegrees: 0 }, printer)
      return total + size.widthMm * size.depthMm
    }, 0)
    const bestArea = best.reduce((total, candidate) => {
      const size = placementDimensions({ ...candidate, rotationZDegrees: 0 }, printer)
      return total + size.widthMm * size.depthMm
    }, 0)
    if (band.length > best.length || (band.length === best.length && bandArea > bestArea)) best = band
  }
  return best
}

export function normalizePrinterProfile(
  profile: Partial<PrinterProfile> & Pick<PrinterProfile, 'id' | 'name' | 'widthMm' | 'depthMm' | 'heightMm'>,
) {
  return {
    id: profile.id,
    name: profile.name,
    widthMm: profile.widthMm,
    depthMm: profile.depthMm,
    heightMm: profile.heightMm,
    spacingMm: profile.spacingMm ?? 5,
    supportMarginMm: profile.supportMarginMm ?? 4,
    adhesionMarginMm: profile.adhesionMarginMm ?? 2,
    heightAllowanceMm: profile.heightAllowanceMm ?? 5,
    maxHeightDifferenceMm: profile.maxHeightDifferenceMm ?? 20,
  } satisfies PrinterProfile
}
