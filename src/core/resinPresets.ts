import catalog from '../../resin-catalog/catalog.generated.json'

export type ResinPreset = {
  id: string
  brand: string
  name: string
  type?: string
  densityGramsPerMl?: number
  densitySource?: { url: string; note: string }
  source: { id: string; url: string }
}

export const RESIN_PRESETS = catalog.presets as ResinPreset[]

export function getResinPreset(id?: string) {
  return id ? RESIN_PRESETS.find((preset) => preset.id === id) : undefined
}
