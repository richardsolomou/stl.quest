import type { PrintType } from './types'

const FILAMENT_DENSITY_G_PER_CM3 = 1.24
const FILAMENT_GRAMS_PER_HOUR = 10
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
  const material = volumeMl === undefined ? undefined : volumeMl * FILAMENT_DENSITY_G_PER_CM3
  return {
    material,
    materialUnit: 'g',
    minutes: filamentMinutes(material, input.modelHeightMm),
  }
}

function filamentMinutes(material?: number, heightMm?: number) {
  const extrusionMinutes = positive(material) ? (material / FILAMENT_GRAMS_PER_HOUR) * 60 : undefined
  const layerMinutes = positive(heightMm) ? (heightMm / FILAMENT_LAYER_HEIGHT_MM) * (FILAMENT_MINIMUM_LAYER_SECONDS / 60) : undefined
  const printingMinutes = Math.max(extrusionMinutes ?? 0, layerMinutes ?? 0)
  return printingMinutes ? FILAMENT_STARTUP_MINUTES + printingMinutes : undefined
}

export function effectivePrintEstimate(input: {
  printType?: PrintType
  modelVolumeMm3?: number
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
