import type { PrintType } from './types'

const FILAMENT_DENSITY_G_PER_CM3 = 1.24
const FILAMENT_INFILL_FRACTION = 0.15
const FILAMENT_EFFECTIVE_SHELL_MM = 1.2
const FILAMENT_MIN_GRAMS_PER_HOUR = 30
const FILAMENT_MAX_GRAMS_PER_HOUR = 45
const FILAMENT_THROUGHPUT_TRANSITION_G = 50
const FILAMENT_STARTUP_MINUTES = 4
const FILAMENT_LAYER_HEIGHT_MM = 0.2
const FILAMENT_MINIMUM_LAYER_SECONDS = 8
const RESIN_WASTE_FACTOR = 1.15
const RESIN_STARTUP_MINUTES = 5
const RESIN_MINUTES_PER_MM = 2.7

export type PrintEstimate = { material?: number; materialUnit: 'g' | 'ml'; minutes?: number }

export function automaticPrintEstimate(input: {
  printType?: PrintType
  modelVolumeMm3?: number
  modelSurfaceAreaMm2?: number
  modelHeightMm?: number
}): PrintEstimate | undefined {
  if (!input.printType) return undefined
  const volumeMl = positive(input.modelVolumeMm3) ? input.modelVolumeMm3 / 1_000 : undefined
  if (input.printType === 'resin') {
    return {
      material: volumeMl === undefined ? undefined : volumeMl * RESIN_WASTE_FACTOR,
      materialUnit: 'ml',
      minutes: positive(input.modelHeightMm) ? RESIN_STARTUP_MINUTES + input.modelHeightMm * RESIN_MINUTES_PER_MM : undefined,
    }
  }
  const material = filamentMaterial(volumeMl, input.modelSurfaceAreaMm2)
  return {
    material,
    materialUnit: 'g',
    minutes: filamentMinutes(material, input.modelHeightMm),
  }
}

function filamentMaterial(volumeMl?: number, surfaceAreaMm2?: number) {
  if (!positive(volumeMl)) return undefined
  if (!positive(surfaceAreaMm2)) return volumeMl * FILAMENT_DENSITY_G_PER_CM3
  const volumeMm3 = volumeMl * 1_000
  const shellMm3 = Math.min(volumeMm3, surfaceAreaMm2 * FILAMENT_EFFECTIVE_SHELL_MM)
  const printedMm3 = shellMm3 + (volumeMm3 - shellMm3) * FILAMENT_INFILL_FRACTION
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

export function effectivePrintEstimate(input: {
  printType?: PrintType
  modelVolumeMm3?: number
  modelSurfaceAreaMm2?: number
  modelHeightMm?: number
  materialOverride?: number
  minutesOverride?: number
}) {
  const automatic = automaticPrintEstimate(input)
  if (!automatic) return undefined
  return {
    material: input.materialOverride ?? automatic.material,
    materialUnit: automatic.materialUnit,
    minutes: input.minutesOverride ?? automatic.minutes,
    materialAdjusted: input.materialOverride !== undefined,
    minutesAdjusted: input.minutesOverride !== undefined,
  }
}

export function formatEstimateMaterial(value: number) {
  return value >= 100 ? Math.round(value).toString() : value >= 10 ? value.toFixed(1) : value.toFixed(2).replace(/\.?0+$/, '')
}

export function formatEstimateTime(minutes: number) {
  const rounded = Math.max(1, Math.round(minutes))
  const hours = Math.floor(rounded / 60)
  const remaining = rounded % 60
  return hours ? `${hours}h${remaining ? ` ${remaining}m` : ''}` : `${remaining}m`
}

function positive(value?: number): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0
}
