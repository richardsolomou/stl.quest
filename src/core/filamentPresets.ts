import type { FilamentColour, FilamentConsumable } from './consumables'

export type FilamentPreset = {
  id: string
  brand: string
  name: string
  type?: string
  densityGramsPerCm3?: number
  colors?: { hex: string; names: { en: string; de?: string; fr?: string } }[]
  source: { id: string; url: string }
}

/** A catalogued filament's stored name: the product, then the colour when one is chosen. */
export function filamentConsumableName(preset: Pick<FilamentPreset, 'brand' | 'name'>, colour?: FilamentColour) {
  const product = `${preset.brand} ${preset.name}`
  return colour ? `${product} · ${colour.name}` : product
}

/** A library filament from the catalogue, unpriced (NaN) since the catalogue knows no prices, with its colour still to pick. */
export function filamentFromPreset(id: string, preset: FilamentPreset): FilamentConsumable {
  return { id, kind: 'filament', name: filamentConsumableName(preset), filamentPresetId: preset.id, pricePerKg: Number.NaN }
}
