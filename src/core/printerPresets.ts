import catalog from '../../printer-catalog/catalog.generated.json'

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

export function filterPrinterPresets(search: string) {
  const terms = normalizeSearch(search).split(' ').filter(Boolean)
  if (!terms.length) return PRINTER_PRESETS
  return PRINTER_PRESETS.filter((preset) => {
    const haystack = normalizeSearch(`${preset.brand} ${preset.model} ${preset.printType}`)
    return terms.every((term) => haystack.includes(term))
  })
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
