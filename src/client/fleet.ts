import type { Messages } from '../core/i18n'
import { PRINT_TYPES, type PrinterSummary, type PrintType } from '../core/types'

export function fleetPrintTypes(printers: PrinterSummary[]) {
  const present = new Set(printers.map((printer) => printer.printType))
  return PRINT_TYPES.filter((printType) => present.has(printType))
}

export function availablePrintTypes(printers?: PrinterSummary[]) {
  const configured = printers ? fleetPrintTypes(printers) : []
  return configured.length ? configured : PRINT_TYPES
}

export function printTypeLabel(t: Messages, printType: PrintType) {
  return t.board.printType[printType]
}
