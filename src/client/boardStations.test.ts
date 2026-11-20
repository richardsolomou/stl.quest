import { describe, expect, it } from 'vitest'
import type { PrinterProfile } from '../core/types'
import { boardStations, startPrinters } from './boardStations'

const mars = { id: 'mars', name: 'Mars', printType: 'resin' as const }
const a1 = { id: 'a1', name: 'A1', printType: 'filament' as const }
const entry = (key: string, printerId?: string) => ({ key, request: { printer: printerId ? { ...mars, id: printerId } : undefined } })

describe('boardStations', () => {
  it('gives every active printer a station in fleet order', () => {
    expect(boardStations([mars, a1], [], []).map((station) => station.printer?.id)).toEqual(['mars', 'a1'])
  })

  it('leaves archived printers out', () => {
    expect(boardStations([mars, { ...a1, archived: true }], [], []).map((station) => station.printer?.id)).toEqual(['mars'])
  })

  it('places printing copies on their assigned printer', () => {
    const [station] = boardStations([mars], [entry('one', 'mars')], [])
    expect(station.entries.map(({ key }) => key)).toEqual(['one'])
  })

  it('collects copies with no active printer into a trailing unassigned station', () => {
    const stations = boardStations([mars], [entry('loose'), entry('gone', 'retired')], [])
    expect(stations.at(-1)).toEqual({ printer: undefined, entries: [entry('loose'), entry('gone', 'retired')], next: undefined })
  })

  it('omits the unassigned station when every copy has a printer', () => {
    expect(boardStations([mars], [entry('one', 'mars')], [])).toHaveLength(1)
  })

  it('offers the first up-next entry assigned to the printer', () => {
    const [, station] = boardStations([mars, a1], [], [entry('lead', 'mars'), entry('first', 'a1'), entry('second', 'a1')])
    expect(station.next?.key).toBe('first')
  })

  it('leaves the lead ticket to the rail rather than offering it twice', () => {
    const [station] = boardStations([mars], [], [entry('lead', 'mars'), entry('second', 'mars')])
    expect(station.next?.key).toBe('second')
  })

  it('offers nothing when no up-next entry is assigned to the printer', () => {
    const [station] = boardStations([mars], [], [entry('elsewhere', 'a1')])
    expect(station.next).toBeUndefined()
  })
})

describe('startPrinters', () => {
  const saturn = { id: 'saturn', name: 'Saturn', printType: 'resin' as const }
  const station = (printer: PrinterProfile, copies = 0) => ({ printer, entries: copies ? [{ count: copies }] : [] })

  it('offers only printers of the print type', () => {
    expect(startPrinters([station(mars), station(a1)], { printType: 'filament' }).map(({ printer }) => printer.id)).toEqual(['a1'])
  })

  it('offers every printer to a print with no print type', () => {
    expect(startPrinters([station(mars), station(a1)], {})).toHaveLength(2)
  })

  it('puts the assigned printer first', () => {
    const starts = startPrinters([station(mars), station(saturn, 2)], { printType: 'resin', printer: saturn })
    expect(starts.map(({ printer }) => printer.id)).toEqual(['saturn', 'mars'])
  })

  it('puts idle printers before busy ones', () => {
    const starts = startPrinters([station(mars, 3), station(saturn)], { printType: 'resin' })
    expect(starts.map(({ printer }) => printer.id)).toEqual(['saturn', 'mars'])
  })

  it('counts the copies a printer is already printing', () => {
    expect(startPrinters([station(mars, 3)], { printType: 'resin' })[0].printing).toBe(3)
  })

  it('leaves out the unassigned station', () => {
    expect(startPrinters([{ printer: undefined, entries: [{ count: 1 }] }], {})).toEqual([])
  })
})
