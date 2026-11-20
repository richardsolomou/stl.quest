import { DEFAULT_LOCALE, type Locale, type Messages } from './i18n'
import { PRINT_TYPES, type PrintRequest, type PrintType, type PublicPrintRequest } from './types'

const FILAMENT_DENSITY_G_PER_CM3 = 1.24
const FILAMENT_LINE_WIDTH_MM = 0.45
const FILAMENT_MIN_GRAMS_PER_HOUR = 30
const FILAMENT_MAX_GRAMS_PER_HOUR = 45
const FILAMENT_THROUGHPUT_TRANSITION_G = 50
const FILAMENT_STARTUP_MINUTES = 4
const FILAMENT_LAYER_HEIGHT_MM = 0.2
const FILAMENT_MINIMUM_LAYER_SECONDS = 8
const RESIN_STARTUP_MINUTES = 5
const RESIN_MINUTES_PER_MM = 2.7

export type PrintEstimate = { material?: number; materialUnit: 'g' | 'ml'; minutes?: number }

/**
 * How the workspace slices, which turns model geometry into material: filament walls and infill as its slicer profile
 * sets them, a percent per print type on top for supports, rafts, purge, and failed bits, and for resin a fixed amount
 * per part, since small parts carry proportionally more support and raft.
 */
export type MaterialEstimateSettings = {
  supportsAndWastePercent: Record<PrintType, number>
  resinPerPartMl: number
  filamentInfillPercent: number
  filamentWalls: number
}

export const DEFAULT_MATERIAL_ESTIMATE_SETTINGS: MaterialEstimateSettings = {
  supportsAndWastePercent: { resin: 60, filament: 25 },
  resinPerPartMl: 1,
  filamentInfillPercent: 15,
  filamentWalls: 2,
}

export const MATERIAL_ESTIMATE_LIMITS = {
  supportsAndWastePercent: { min: 0, max: 200 },
  resinPerPartMl: { min: 0, max: 100 },
  filamentInfillPercent: { min: 0, max: 100 },
  filamentWalls: { min: 1, max: 20 },
} as const

export function validMaterialEstimateSettings(settings: MaterialEstimateSettings) {
  const within = (value: number, { min, max }: { min: number; max: number }) => Number.isFinite(value) && value >= min && value <= max
  return (
    PRINT_TYPES.every((printType) =>
      within(settings.supportsAndWastePercent[printType], MATERIAL_ESTIMATE_LIMITS.supportsAndWastePercent),
    ) &&
    within(settings.resinPerPartMl, MATERIAL_ESTIMATE_LIMITS.resinPerPartMl) &&
    within(settings.filamentInfillPercent, MATERIAL_ESTIMATE_LIMITS.filamentInfillPercent) &&
    Number.isInteger(settings.filamentWalls) &&
    within(settings.filamentWalls, MATERIAL_ESTIMATE_LIMITS.filamentWalls)
  )
}

/** Filament time follows the grams extruded, supports and purge included; resin time follows height alone. */
export function automaticPrintEstimate(
  input: {
    printType?: PrintType
    modelVolumeMm3?: number
    modelSurfaceAreaMm2?: number
    modelHeightMm?: number
  },
  settings: MaterialEstimateSettings,
): PrintEstimate | undefined {
  if (!input.printType) return undefined
  const allowance = 1 + settings.supportsAndWastePercent[input.printType] / 100
  const volumeMl = positive(input.modelVolumeMm3) ? input.modelVolumeMm3 / 1_000 : undefined
  if (input.printType === 'resin') {
    return {
      material: volumeMl === undefined ? undefined : volumeMl * allowance + settings.resinPerPartMl,
      materialUnit: 'ml',
      minutes: positive(input.modelHeightMm) ? RESIN_STARTUP_MINUTES + input.modelHeightMm * RESIN_MINUTES_PER_MM : undefined,
    }
  }
  const sliced = filamentMaterial(settings, volumeMl, input.modelSurfaceAreaMm2)
  const material = sliced === undefined ? undefined : sliced * allowance
  return {
    material,
    materialUnit: 'g',
    minutes: filamentMinutes(material, input.modelHeightMm),
  }
}

function filamentMaterial(settings: MaterialEstimateSettings, volumeMl?: number, surfaceAreaMm2?: number) {
  if (!positive(volumeMl)) return undefined
  if (!positive(surfaceAreaMm2)) return volumeMl * FILAMENT_DENSITY_G_PER_CM3
  const volumeMm3 = volumeMl * 1_000
  const shellMm3 = Math.min(volumeMm3, surfaceAreaMm2 * settings.filamentWalls * FILAMENT_LINE_WIDTH_MM)
  const printedMm3 = shellMm3 + (volumeMm3 - shellMm3) * (settings.filamentInfillPercent / 100)
  return (printedMm3 / 1_000) * FILAMENT_DENSITY_G_PER_CM3
}

function filamentMinutes(material?: number, heightMm?: number) {
  const gramsPerHour = positive(material)
    ? FILAMENT_MIN_GRAMS_PER_HOUR +
      (FILAMENT_MAX_GRAMS_PER_HOUR - FILAMENT_MIN_GRAMS_PER_HOUR) * (1 - Math.exp(-material / FILAMENT_THROUGHPUT_TRANSITION_G))
    : undefined
  const extrusionMinutes = positive(material) && gramsPerHour ? (material / gramsPerHour) * 60 : undefined
  const layerMinutes = positive(heightMm) ? (heightMm / FILAMENT_LAYER_HEIGHT_MM) * (FILAMENT_MINIMUM_LAYER_SECONDS / 60) : undefined
  const printingMinutes = Math.max(extrusionMinutes ?? 0, layerMinutes ?? 0)
  return printingMinutes ? FILAMENT_STARTUP_MINUTES + printingMinutes : undefined
}

/** The automatic estimate a listed print carries, in the print type it resolves to, worked out on every read so settings apply at once. */
export function automaticEstimateFields(
  request: Pick<PrintRequest, 'modelDimensions' | 'modelVolumeMm3' | 'modelSurfaceAreaMm2'>,
  printType: PrintType | undefined,
  settings: MaterialEstimateSettings,
) {
  const estimate = automaticPrintEstimate(
    {
      printType,
      modelVolumeMm3: request.modelVolumeMm3,
      modelSurfaceAreaMm2: request.modelSurfaceAreaMm2,
      modelHeightMm: request.modelDimensions?.heightMm,
    },
    settings,
  )
  return {
    automaticEstimatedMaterial: estimate?.material,
    automaticEstimatedPrintMinutes: estimate?.minutes,
    estimatedMaterialUnit: estimate?.materialUnit,
  }
}

/** A print's estimate per copy: the admin's adjustments where set, otherwise the automatic estimate. */
export function requestPrintEstimate(
  request: Pick<
    PublicPrintRequest,
    | 'printType'
    | 'automaticEstimatedMaterial'
    | 'automaticEstimatedPrintMinutes'
    | 'estimatedMaterialUnit'
    | 'estimatedMaterialOverride'
    | 'estimatedPrintMinutesOverride'
  >,
) {
  if (!request.printType) return undefined
  return {
    material: request.estimatedMaterialOverride ?? request.automaticEstimatedMaterial,
    materialUnit: request.estimatedMaterialUnit ?? (request.printType === 'resin' ? 'ml' : 'g'),
    minutes: request.estimatedPrintMinutesOverride ?? request.automaticEstimatedPrintMinutes,
    materialAdjusted: request.estimatedMaterialOverride !== undefined,
    minutesAdjusted: request.estimatedPrintMinutesOverride !== undefined,
  }
}

/** The geometry a fresh or replaced model still owes, so the missing estimate reads as pending rather than absent. */
export function estimatePending(request: Pick<PublicPrintRequest, 'estimateGeometryStatus'>) {
  return request.estimateGeometryStatus === 'pending' || request.estimateGeometryStatus === 'running'
}

export function formatEstimateMaterial(value: number, locale: Locale = DEFAULT_LOCALE) {
  const [minimumFractionDigits, maximumFractionDigits] = value >= 100 ? [0, 0] : value >= 10 ? [1, 1] : [0, 2]
  return new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits, useGrouping: false }).format(value)
}

export function formatEstimateTime(minutes: number, t: Messages['requests']) {
  const rounded = Math.max(1, Math.round(minutes))
  return t.estimateTime(Math.floor(rounded / 60), rounded % 60)
}

function positive(value?: number): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0
}
