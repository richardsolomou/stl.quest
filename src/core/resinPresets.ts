import type { ResinConsumable } from './consumables'
import { TYPICAL_RESIN_DENSITY_GRAMS_PER_ML } from './priceCalculator'

export type ResinPreset = {
  id: string
  brand: string
  name: string
  type?: string
  densityGramsPerMl?: number
  densitySource?: { url: string; note: string }
  source: { id: string; url: string }
  /** The manufacturer's product photo, served from the app's own files. */
  image?: { src: string }
}

export function resinPresetName(preset: Pick<ResinPreset, 'brand' | 'name'>) {
  return `${preset.brand} ${preset.name}`
}

/** A library resin from the catalogue, unpriced (NaN) since the catalogue knows no prices, and typically dense when it does not say. */
export function resinFromPreset(id: string, preset: ResinPreset): ResinConsumable {
  return {
    id,
    kind: 'resin',
    name: resinPresetName(preset),
    resinPresetId: preset.id,
    pricePerLitre: Number.NaN,
    densityGramsPerMl: preset.densityGramsPerMl ?? TYPICAL_RESIN_DENSITY_GRAMS_PER_ML,
  }
}
