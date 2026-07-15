import type { PrinterSummary, PrintType } from '../core/types'

export type RequestTarget = 'later' | `type:${PrintType}` | `printer:${string}`

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

export function automaticPrinterId(printers: PrinterSummary[]) {
  const enabled = enabledPrinters(printers)
  return enabled.length === 1 ? enabled[0].id : undefined
}

export function initialRequestTarget(
  printers: PrinterSummary[],
  target: { requestedPrintType?: PrintType; printerId?: string } = {},
): RequestTarget {
  const assigned = target.printerId && printers.find((printer) => printer.id === target.printerId)
  if (assigned) return `printer:${assigned.id}`
  if (target.requestedPrintType) return `type:${target.requestedPrintType}`
  const automatic = automaticPrinterId(printers)
  if (automatic) return `printer:${automatic}`
  return 'later'
}

export function requestTargetFields(target: RequestTarget): { requestedPrintType?: PrintType; printerId?: string } {
  if (target.startsWith('printer:')) return { printerId: target.slice('printer:'.length) }
  if (target.startsWith('type:')) return { requestedPrintType: target.slice('type:'.length) as PrintType }
  return {}
}

export function requestTargetOptions(printers: PrinterSummary[], currentPrinterId?: string, currentRequestedPrintType?: PrintType) {
  const enabled = enabledPrinters(printers)
  const printTypes = [...new Set([...fleetPrintTypes(enabled), ...(currentRequestedPrintType ? [currentRequestedPrintType] : [])])]
  const mixed = printTypes.length > 1
  const options: { value: RequestTarget; label: string }[] = [{ value: 'later', label: 'Decide later' }]

  for (const printType of printTypes) {
    options.push({ value: `type:${printType}`, label: `Any ${printTypeLabel(printType)} printer` })
  }
  for (const printer of enabled) {
    options.push({
      value: `printer:${printer.id}`,
      label: mixed ? `${printer.name} · ${printTypeLabel(printer.printType)}` : printer.name,
    })
  }

  const current = currentPrinterId && printers.find((printer) => printer.id === currentPrinterId)
  if (current && !current.enabled) {
    options.push({ value: `printer:${current.id}`, label: `${current.name} (disabled)` })
  }
  return options
}

export function showRequestTarget(printers: PrinterSummary[], currentPrinterId?: string, currentRequestedPrintType?: PrintType) {
  const current = currentPrinterId && printers.find((printer) => printer.id === currentPrinterId)
  const enabled = enabledPrinters(printers)
  if (enabled.length > 1 || (!!current && !current.enabled)) return true
  return !!currentRequestedPrintType && enabled[0]?.printType !== currentRequestedPrintType
}

export function printTypeLabel(printType: PrintType) {
  return printType === 'resin' ? 'Resin' : 'Filament'
}
