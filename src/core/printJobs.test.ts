import { describe, expect, it } from 'vitest'
import type { FilamentConsumable } from './consumables'
import type { Plate } from './plates'
import {
  bambuddyReport,
  continuedPrintJob,
  displayedGrams,
  displayedMinutes,
  displayedTrays,
  printFilaments,
  printJobLink,
  printerNamed,
  printerRunCounts,
  type PrintJob,
} from './printJobs'

const plate = (fields: Partial<Plate> = {}): Plate => ({
  id: 'plate',
  number: 4,
  printerId: 'x2d',
  otherStuff: false,
  items: [{ requestId: 'hull', copies: 2 }],
  stage: 'in_progress',
  startedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  ...fields,
})

const job = (fields: Partial<PrintJob> = {}): PrintJob => ({
  id: 'job',
  printerName: 'X2D',
  outcome: 'finished',
  personal: false,
  receivedAt: 1,
  ...fields,
})

describe('displayedMinutes', () => {
  it('reads hours and minutes', () => {
    expect(displayedMinutes('1h 23m')).toBe(83)
  })

  it('reads minutes alone', () => {
    expect(displayedMinutes('45m')).toBe(45)
  })

  it('leaves an unknown duration out', () => {
    expect(displayedMinutes('Unknown')).toBeUndefined()
  })
})

describe('displayedGrams', () => {
  it('reads a bare number', () => {
    expect(displayedGrams('12.3')).toBe(12.3)
  })

  it('reads a number with its unit', () => {
    expect(displayedGrams('12.3g')).toBe(12.3)
  })

  it('leaves unknown grams out', () => {
    expect(displayedGrams('Unknown')).toBeUndefined()
  })
})

describe('displayedTrays', () => {
  it('reads each AMS tray’s material and grams', () => {
    expect(displayedTrays('AMS-A T1 PLA: 12.3g | AMS-A T2 PETG: 4.0g')).toEqual([
      { material: 'PLA', grams: 12.3 },
      { material: 'PETG', grams: 4 },
    ])
  })

  it('reads the external spool', () => {
    expect(displayedTrays('Ext PLA Basic: 3.0g')).toEqual([{ material: 'PLA Basic', grams: 3 }])
  })

  it('reads an AMS unit named with a space', () => {
    expect(displayedTrays('AMS 3H T2 ABS: 1.5g')).toEqual([{ material: 'ABS', grams: 1.5 }])
  })

  it('reads slots the slicer file listed', () => {
    expect(displayedTrays('PLA: 12.3g | PETG-CF: 1.0g')).toEqual([
      { material: 'PLA', grams: 12.3 },
      { material: 'PETG-CF', grams: 1 },
    ])
  })

  it('leaves an unknown material out', () => {
    expect(displayedTrays('AMS-A T1 Unknown: 2.0g')).toEqual([{ grams: 2 }])
  })

  it('skips parts it cannot read', () => {
    expect(displayedTrays('AMS-A T1 PLA | PETG: 4.0g')).toEqual([{ material: 'PETG', grams: 4 }])
  })
})

describe('printFilaments', () => {
  const pla: FilamentConsumable = { id: 'pla', kind: 'filament', name: 'Bambu PLA Basic', pricePerKg: 20 }
  const petg: FilamentConsumable = { id: 'petg', kind: 'filament', name: 'Bambu PETG HF', pricePerKg: 25 }
  const materials: Record<string, string> = { pla: 'PLA', petg: 'PETG' }
  const materialOf = (filament: FilamentConsumable) => materials[filament.id]

  it('puts each tray on the first filament of its material', () => {
    expect(printFilaments({ grams: 16, filamentDetails: 'AMS-A T1 PETG: 4.0g | AMS-A T2 PLA: 12.0g' }, [pla, petg], materialOf)).toEqual([
      { filament: petg, grams: 4 },
      { filament: pla, grams: 12 },
    ])
  })

  it('puts a tray of a material the library lacks on the first filament', () => {
    expect(printFilaments({ grams: 3, filamentDetails: 'Ext TPU: 3.0g' }, [pla, petg], materialOf)).toEqual([{ filament: pla, grams: 3 }])
  })

  it('adds trays of the same filament together', () => {
    expect(printFilaments({ filamentDetails: 'AMS-A T1 PLA: 2.0g | AMS-A T2 PLA: 3.0g' }, [pla, petg], materialOf)).toEqual([
      { filament: pla, grams: 5 },
    ])
  })

  it('takes measured trays as the whole print', () => {
    expect(printFilaments({ grams: 12, filamentDetails: 'AMS-A T1 PETG: 4.0g' }, [pla, petg], materialOf)).toEqual([
      { filament: petg, grams: 4 },
    ])
  })

  it('puts grams the slicer slots do not account for on the first filament', () => {
    expect(printFilaments({ grams: 10, filamentDetails: 'PETG: 4.0g' }, [pla, petg], materialOf)).toEqual([
      { filament: petg, grams: 4 },
      { filament: pla, grams: 6 },
    ])
  })

  it('ignores slicer slots missing the total only by rounding', () => {
    expect(printFilaments({ grams: 10, filamentDetails: 'PLA: 3.3g | PETG: 6.6g' }, [pla, petg], materialOf)).toEqual([
      { filament: pla, grams: 3.3 },
      { filament: petg, grams: 6.6 },
    ])
  })

  it('puts every gram on the first filament without trays', () => {
    expect(printFilaments({ grams: 10 }, [pla, petg], materialOf)).toEqual([{ filament: pla, grams: 10 }])
  })

  it('uses nothing without a library filament', () => {
    expect(printFilaments({ grams: 10, filamentDetails: 'PLA: 10.0g' }, [], materialOf)).toEqual([])
  })
})

describe('bambuddyReport', () => {
  it('reads a finished print', () => {
    expect(
      bambuddyReport({
        event: 'print_complete',
        printer: 'X2D',
        filename: 'SQ-7 Hull',
        duration: '2h 5m',
        filament_grams: '40.5',
        run_id: '12',
        archive_id: '3',
      }),
    ).toEqual({ outcome: 'finished', printerName: 'X2D', fileName: 'SQ-7 Hull', minutes: 125, grams: 40.5, runId: '12', archiveId: '3' })
  })

  it('reads a stopped print as cancelled', () => {
    expect(bambuddyReport({ event: 'print_stopped', printer: 'X2D' })?.outcome).toBe('cancelled')
  })

  it('reads how far a failed print got', () => {
    expect(bambuddyReport({ event: 'print_failed', printer: 'X2D', progress: '42' })?.progress).toBe(42)
  })

  it('reads a start as printing', () => {
    expect(bambuddyReport({ event: 'print_start', printer: 'X2D' })?.outcome).toBe('printing')
  })

  it('ignores other notifications', () => {
    expect(bambuddyReport({ event: 'printer_offline', printer: 'X2D' })).toBeUndefined()
  })

  it('drops a reason Bambuddy did not know', () => {
    expect(bambuddyReport({ event: 'print_failed', printer: 'X2D', reason: 'Unknown' })?.reason).toBeUndefined()
  })
})

describe('printerNamed', () => {
  const printers = [
    { id: 'x2d', name: 'X2D' },
    { id: 'a1', name: 'A1 mini' },
  ]

  it('matches a printer whatever the case and spacing', () => {
    expect(printerNamed(printers, '  a1 MINI ')?.id).toBe('a1')
  })

  it('skips archived printers', () => {
    expect(printerNamed([{ id: 'x2d', name: 'X2D', archived: true }], 'X2D')).toBeUndefined()
  })

  it('matches no printer when two share the name', () => {
    expect(printerNamed([...printers, { id: 'other', name: 'x2d' }], 'X2D')).toBeUndefined()
  })
})

describe('printJobLink', () => {
  const requests = [
    { id: 'hull', number: 7 },
    { id: 'turret', number: 8 },
  ]

  it('links to the plate printing on the printer', () => {
    expect(printJobLink(job({ printerId: 'x2d' }), [plate()], requests, [])).toEqual({ plateId: 'plate', by: 'printer' })
  })

  it('links by the request tag when nothing is printing there', () => {
    expect(printJobLink(job({ fileName: 'SQ-7 Hull' }), [plate({ printerId: 'other' })], requests, [])).toEqual({
      plateId: 'plate',
      by: 'tag',
    })
  })

  it('links by tag to the newest plate not recorded yet', () => {
    expect(
      printJobLink(
        job({ fileName: 'SQ-7 Hull' }),
        [plate({ id: 'old', stage: undefined }), plate({ id: 'new', number: 5, stage: undefined })],
        requests,
        [],
      ),
    ).toEqual({ plateId: 'new', by: 'tag' })
  })

  it('suggests the tagged request when it is on no plate', () => {
    expect(printJobLink(job({ fileName: 'SQ-8 Turret' }), [plate()], requests, [])).toEqual({ requestId: 'turret', by: 'tag' })
  })

  it('links nothing on the printer once another print is linked to its plate', () => {
    expect(printJobLink(job({ id: 'next', printerId: 'x2d' }), [plate()], requests, [job({ plateId: 'plate' })])).toBeUndefined()
  })

  it('links by tag to no plate whose run already ended', () => {
    expect(
      printJobLink(job({ id: 'reprint', fileName: 'SQ-7 Hull' }), [plate({ stage: undefined })], requests, [
        job({ plateId: 'plate', outcome: 'failed' }),
      ]),
    ).toEqual({ requestId: 'hull', by: 'tag' })
  })

  it('links nothing without a printing plate or a tag', () => {
    expect(printJobLink(job({ fileName: 'Benchy' }), [plate()], requests, [])).toBeUndefined()
  })
})

describe('printerRunCounts', () => {
  const linked = { printerId: 'x2d', plateId: 'plate' }

  it('counts finished and failed plate runs per printer', () => {
    expect(
      printerRunCounts([
        job(linked),
        job({ ...linked, outcome: 'failed' }),
        job({ ...linked, outcome: 'cancelled' }),
        job({ ...linked, outcome: 'printing' }),
      ]),
    ).toEqual([{ printerId: 'x2d', runs: 2, failed: 1 }])
  })

  it('leaves out prints on no plate', () => {
    expect(printerRunCounts([job({ printerId: 'x2d' })])).toEqual([])
  })
})

describe('continuedPrintJob', () => {
  const started = job({ id: 'started', outcome: 'printing', fileName: 'SQ-7 Hull' })

  it('continues the print started on the same printer under the same name', () => {
    expect(continuedPrintJob([started], { outcome: 'finished', printerName: 'x2d', fileName: 'SQ-7 Hull' })?.id).toBe('started')
  })

  it('continues the print with the same run', () => {
    expect(continuedPrintJob([job({ id: 'run', runId: '12' })], { outcome: 'finished', printerName: 'X2D', runId: '12' })?.id).toBe('run')
  })

  it('starts a new print for another name', () => {
    expect(continuedPrintJob([started], { outcome: 'finished', printerName: 'X2D', fileName: 'Benchy' })).toBeUndefined()
  })

  it('starts a new print for each start', () => {
    expect(continuedPrintJob([started], { outcome: 'printing', printerName: 'X2D', fileName: 'SQ-7 Hull' })).toBeUndefined()
  })
})
