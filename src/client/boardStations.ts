import type { PrinterProfile, PrinterSummary, PrintType } from '../core/types'

type StationEntry = { request: { printer?: Pick<PrinterSummary, 'id'> } }

export type BoardStation<Entry> = { printer?: PrinterProfile; entries: Entry[]; next?: Entry }

/**
 * The printing stage as the fleet sees it: one station per active printer in fleet order, each holding the copies
 * assigned to it and the first up-next entry waiting for it (bar the lead ticket, which the rail already offers), then any
 * copies no active printer owns.
 */
export function boardStations<Entry extends StationEntry>(
  printers: PrinterProfile[],
  printing: Entry[],
  upNext: Entry[],
): BoardStation<Entry>[] {
  const active = printers.filter((printer) => !printer.archived)
  const stations: BoardStation<Entry>[] = active.map((printer) => ({
    printer,
    entries: printing.filter((entry) => entry.request.printer?.id === printer.id),
    next: upNext.slice(1).find((entry) => entry.request.printer?.id === printer.id),
  }))
  const activeIds = new Set(active.map((printer) => printer.id))
  const unassigned = printing.filter((entry) => !entry.request.printer || !activeIds.has(entry.request.printer.id))
  if (unassigned.length) stations.push({ printer: undefined, entries: unassigned, next: undefined })
  return stations
}

/** A printer a print can start on, with the copies it is already printing. */
export type StartPrinter = { printer: PrinterProfile; printing: number; assigned: boolean }

/**
 * The printers a print can start on: every station printer of its print type (any printer when it has none), its assigned
 * printer first, then idle printers before busy ones, each in fleet order.
 */
export function startPrinters(
  stations: BoardStation<{ count: number }>[],
  request: { printType?: PrintType; printer?: Pick<PrinterSummary, 'id' | 'printType'> },
): StartPrinter[] {
  const printType = request.printType ?? request.printer?.printType
  const rank = (start: StartPrinter) => (start.assigned ? 0 : start.printing ? 2 : 1)
  return stations
    .flatMap(({ printer, entries }) =>
      printer && (!printType || printer.printType === printType)
        ? [
            {
              printer,
              printing: entries.reduce((sum, entry) => sum + entry.count, 0),
              assigned: printer.id === request.printer?.id,
            },
          ]
        : [],
    )
    .sort((left, right) => rank(left) - rank(right))
}
