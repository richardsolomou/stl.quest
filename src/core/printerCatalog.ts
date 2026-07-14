import catalog from '../data/printerCatalog.json'
import type { PrintTechnology } from './types'

export type PrinterCatalogEntry = {
  id: string
  manufacturer: string
  model: string
  technology: PrintTechnology
  widthMm: number
  depthMm: number
  heightMm: number
  source: { project: 'bambu-studio' | 'cura' | 'uvtools'; upstreamId: string; revision: string }
}

export const printerCatalog = catalog as PrinterCatalogEntry[]

export function printerCatalogLabel(printer: Pick<PrinterCatalogEntry, 'manufacturer' | 'model'>) {
  if (printer.model.toLowerCase().startsWith(printer.manufacturer.toLowerCase())) return printer.model
  return `${printer.manufacturer} ${printer.model}`
}
