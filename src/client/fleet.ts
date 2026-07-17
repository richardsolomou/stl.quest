import type { PrinterSummary, PrintType, PublicPrintRequest } from '../core/types'

export type FitState = 'pending' | 'selected_printer' | 'another_compatible_printer' | 'none'

export function enabledPrinters(printers: PrinterSummary[]) {
  return printers.filter((printer) => printer.enabled)
}

export function fleetPrintTypes(printers: PrinterSummary[]) {
  const present = new Set(enabledPrinters(printers).map((printer) => printer.printType))
  return (['resin', 'filament'] as const).filter((printType) => present.has(printType))
}

export function printersForPrintType(printers: PrinterSummary[], printType?: PrintType) {
  return printType ? enabledPrinters(printers).filter((printer) => printer.printType === printType) : []
}

export function availablePrintTypes(printers?: PrinterSummary[]) {
  const configured = printers ? fleetPrintTypes(printers) : []
  return configured.length ? configured : (['resin', 'filament'] as const)
}

export function printTypeLabel(printType: PrintType) {
  return printType === 'resin' ? 'Resin' : 'Filament'
}

export function fitState(request: Pick<PublicPrintRequest, 'fitState' | 'compatiblePrinterIds' | 'printerId'>): FitState | undefined {
  if (request.fitState) return request.fitState
  if (request.compatiblePrinterIds?.length === 0) return 'none'
  if (request.compatiblePrinterIds?.length) {
    if (!request.printerId) return undefined
    return request.compatiblePrinterIds.includes(request.printerId) ? 'selected_printer' : 'another_compatible_printer'
  }
  return undefined
}
