import type { FilamentAssumptions, PrintType } from './types'

const RESIN_ASSUMPTION = 'Solid model volume only; supports, hollowing, drainage, and printing waste are excluded.'
const FILAMENT_ASSUMPTION = '100%-solid equivalent only; walls, infill, supports, brims, rafts, purge, and slicer settings are excluded.'

export type ResinMaterialEstimate = {
  printType: 'resin'
  unit: 'ml'
  perCopy: number
  total: number
  assumption: string
}

export type FilamentMaterialEstimate = {
  printType: 'filament'
  unit: 'g'
  perCopy: number
  total: number
  densityGPerCm3: number
  assumption: string
}

export type MaterialEstimate = ResinMaterialEstimate | FilamentMaterialEstimate

export function estimateMaterialUsage(input: {
  printType: PrintType
  estimatedVolumeMm3?: number
  quantity?: number
  printer?: {
    printType: PrintType
    filamentDiameterMm?: number
    materialDensityGPerCm3?: number
  }
  filamentAssumptions?: FilamentAssumptions
}): MaterialEstimate | undefined {
  const { printType, estimatedVolumeMm3, printer } = input
  if (estimatedVolumeMm3 === undefined || !Number.isFinite(estimatedVolumeMm3) || estimatedVolumeMm3 < 0) return undefined
  const quantity = input.quantity ?? 1
  if (!Number.isInteger(quantity) || quantity < 1) return undefined

  const volumeMl = estimatedVolumeMm3 / 1_000
  if (printType === 'resin') {
    return { printType, unit: 'ml', perCopy: volumeMl, total: volumeMl * quantity, assumption: RESIN_ASSUMPTION }
  }

  const assumptions = input.filamentAssumptions ?? (printer?.printType === 'filament' ? printer : undefined)
  if (!assumptions) return undefined
  const { materialDensityGPerCm3 } = assumptions
  if (materialDensityGPerCm3 === undefined) return undefined
  if (!Number.isFinite(materialDensityGPerCm3) || materialDensityGPerCm3 <= 0) return undefined

  const perCopy = volumeMl * materialDensityGPerCm3
  return {
    printType,
    unit: 'g',
    perCopy,
    total: perCopy * quantity,
    densityGPerCm3: materialDensityGPerCm3,
    assumption: FILAMENT_ASSUMPTION,
  }
}
