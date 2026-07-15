import type { PrinterSummary, PrintTechnology } from '../core/types'

export function fleetTechnologies(printers: PrinterSummary[]) {
  return [...new Set(printers.map((printer) => printer.technology))]
}

export function printersForTechnology(printers: PrinterSummary[], technology?: PrintTechnology) {
  return technology ? printers.filter((printer) => printer.technology === technology) : []
}

export function automaticPrinterId(printers: PrinterSummary[], technology?: PrintTechnology) {
  const matching = printersForTechnology(printers, technology)
  return matching.length === 1 ? matching[0].id : undefined
}
