import catalog from '../../catalogs/printers/catalog.generated.json'

export type PrinterPreset = {
  id: string
  brand: string
  model: string
  printType: 'resin' | 'filament'
  widthMm: number
  depthMm: number
  heightMm: number
  filamentDiameterMm?: number
  image?: { src: string; sourceId: string; sourceUrl: string }
  source: { id: string; url: string }
}

export const PRINTER_PRESETS = catalog.presets as PrinterPreset[]

export const CLOSEST_PRINTER_PRESET_LIMIT = 12

/** Matches every search word against brand, model, and print type, also with spaces removed so `saturn4` finds `Saturn 4`. When nothing matches every word, returns the presets matching the most words as `closest`. */
export function filterPrinterPresets(search: string, presets: readonly PrinterPreset[] = PRINTER_PRESETS) {
  const terms = normalizeSearch(search).split(' ').filter(Boolean)
  if (!terms.length) return { presets, closest: false }
  const scored = presets.map((preset) => {
    const haystack = normalizeSearch(`${preset.brand} ${preset.model} ${preset.printType}`)
    const compact = haystack.replaceAll(' ', '')
    return { preset, matches: terms.filter((term) => haystack.includes(term) || compact.includes(term)).length }
  })
  const exact = scored.filter(({ matches }) => matches === terms.length)
  if (exact.length) return { presets: exact.map(({ preset }) => preset), closest: false }
  const closest = scored
    .filter(({ matches }) => matches > 0)
    .sort((a, b) => b.matches - a.matches)
    .slice(0, CLOSEST_PRINTER_PRESET_LIMIT)
    .map(({ preset }) => preset)
  return { presets: closest, closest: closest.length > 0 }
}

export function getPrinterPreset(id?: string) {
  return id ? PRINTER_PRESETS.find((preset) => preset.id === id) : undefined
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
