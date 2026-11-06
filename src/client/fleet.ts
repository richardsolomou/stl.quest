import type { Messages } from '../core/i18n'
import type { PrinterSummary, PrintType } from '../core/types'

export function fleetPrintTypes(printers: PrinterSummary[]) {
  const present = new Set(printers.map((printer) => printer.printType))
  return (['resin', 'filament'] as const).filter((printType) => present.has(printType))
}

export function printersForPrintType(printers: PrinterSummary[], printType?: PrintType) {
  return printType ? printers.filter((printer) => printer.printType === printType) : []
}

export function availablePrintTypes(printers?: PrinterSummary[]) {
  const configured = printers ? fleetPrintTypes(printers) : []
  return configured.length ? configured : (['resin', 'filament'] as const)
}

export function printTypeLabel(t: Messages, printType: PrintType) {
  return t.board.printType[printType]
}
