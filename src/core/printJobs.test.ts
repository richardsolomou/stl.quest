import { describe, expect, it } from 'vitest'
import type { FilamentConsumable } from './consumables'
import type { Plate, PlateRecording } from './plates'
import type { SlicedPlate } from './slicedPlate'
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
  printSlicedPlate,
  printSpoolMaterials,
  sameSpoolUsage,
  slicedPrintInput,
  SLICED_FILE_WAIT_MS,
  wantsSlicedFile,
  type PrintSlicedPlate,
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

  it('keeps a PLA+ tray off a PLA filament', () => {
    expect(printFilaments({ grams: 4, filamentDetails: 'AMS-A T1 PLA+: 4.0g' }, [petg, pla], materialOf)).toEqual([
      { filament: petg, grams: 4 },
    ])
  })

  it('puts a PLA tray on a PLA+ filament when the library has no plain PLA', () => {
    // Bambu Studio's eSUN and SUNLU PLA+ profiles inherit filament_type PLA, so their trays report plain PLA.
    const plaPlus: FilamentConsumable = { id: 'pla+', kind: 'filament', name: 'eSUN PLA+', pricePerKg: 18 }
    const of = (filament: FilamentConsumable) => ({ ...materials, 'pla+': 'PLA+' })[filament.id]
    expect(printFilaments({ grams: 12, filamentDetails: 'AMS-A T1 PLA: 12.0g' }, [petg, plaPlus], of)).toEqual([
      { filament: plaPlus, grams: 12 },
    ])
  })

  it('prefers a plain PLA filament for a PLA tray', () => {
    const plaPlus: FilamentConsumable = { id: 'pla+', kind: 'filament', name: 'eSUN PLA+', pricePerKg: 18 }
    const of = (filament: FilamentConsumable) => ({ ...materials, 'pla+': 'PLA+' })[filament.id]
    expect(printFilaments({ grams: 12, filamentDetails: 'AMS-A T1 PLA: 12.0g' }, [plaPlus, pla], of)).toEqual([
      { filament: pla, grams: 12 },
    ])
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

describe('printSpoolMaterials', () => {
  const black = { id: 'black' }
  const white = { id: 'white' }
  const context = {
    spools: [
      { id: 1, filamentId: 10 },
      { id: 2, filamentId: 10 },
      { id: 3, filamentId: 20 },
      { id: 4, filamentId: 30 },
    ],
    matches: new Map([
      [10, { consumableId: 'black' }],
      [20, { consumableId: 'white' }],
    ]),
    library: [black, white],
  }

  it('charges each spool to the library filament its Spoolman filament counts towards', () => {
    expect(printSpoolMaterials([{ spoolId: 3, grams: 4 }], context)).toEqual({ materials: [white], totals: [4] })
  })

  it('adds up spools of the same filament', () => {
    expect(
      printSpoolMaterials(
        [
          { spoolId: 1, grams: 10 },
          { spoolId: 2, grams: 5 },
        ],
        context,
      ).totals,
    ).toEqual([15])
  })

  it('charges an unmatched spool to the fallback', () => {
    expect(printSpoolMaterials([{ spoolId: 4, grams: 2 }], { ...context, fallback: black })).toEqual({ materials: [black], totals: [2] })
  })

  it('leaves out a spool STL Quest has not received when there is no fallback', () => {
    expect(printSpoolMaterials([{ spoolId: 99, grams: 2 }], context).materials).toEqual([])
  })
})

describe('sameSpoolUsage', () => {
  it('ignores the order spools come in', () => {
    expect(
      sameSpoolUsage(
        [
          { spoolId: 1, grams: 2 },
          { spoolId: 3, grams: 4 },
        ],
        [
          { spoolId: 3, grams: 4 },
          { spoolId: 1, grams: 2 },
        ],
      ),
    ).toBe(true)
  })

  it('tells a changed amount apart', () => {
    expect(sameSpoolUsage([{ spoolId: 1, grams: 2 }], [{ spoolId: 1, grams: 3 }])).toBe(false)
  })

  it('treats a print without a report as different', () => {
    expect(sameSpoolUsage(undefined, [])).toBe(false)
  })
})

describe('printSlicedPlate', () => {
  const sliced: SlicedPlate = {
    index: 1,
    objects: [
      { id: '1', name: 'SQ-1 Hull.stl', grams: [0, 20] },
      { id: '2', name: 'Other.stl', grams: [0, 10] },
    ],
    overhead: [0, 4],
    filaments: [{ slot: 1, type: 'PLA', color: '#000000', density: 1.24, diameter: 1.75 }],
    printed: {
      objects: [
        [0, 20],
        [0, 3],
      ],
      overhead: [0, 2],
    },
  }

  it('keeps each object’s amounts for the filaments the plate uses, on the print it matched', () => {
    expect(printSlicedPlate(sliced, ['hull', undefined], false).objects).toEqual([{ requestId: 'hull', amounts: [20] }, { amounts: [10] }])
  })

  it('takes what was printed for a print that stopped', () => {
    expect(printSlicedPlate(sliced, ['hull', undefined], true)).toMatchObject({
      objects: [{ amounts: [20] }, { amounts: [3] }],
      overhead: [2],
      cut: true,
    })
  })

  it('says a stopped print’s file could not show where it stopped', () => {
    expect(printSlicedPlate({ ...sliced, printed: undefined }, ['hull'], true)).toMatchObject({ overhead: [4], cut: false })
  })

  it('keeps the filaments’ type and colour', () => {
    expect(printSlicedPlate(sliced, [], false).filaments).toEqual([{ type: 'PLA', color: '#000000' }])
  })
})

describe('slicedPrintInput', () => {
  const sliced: PrintSlicedPlate = {
    filaments: [{ type: 'PLA' }, { type: 'PETG' }],
    objects: [
      { requestId: 'hull', amounts: [10, 0] },
      { requestId: 'turret', amounts: [0, 5] },
    ],
    overhead: [2, 1],
  }
  const total = ({ input }: ReturnType<typeof slicedPrintInput<string>>) =>
    input.objects.reduce((sum, object) => sum + object.amounts.reduce((a, b) => a + b, 0), 0) + input.overhead.reduce((a, b) => a + b, 0)

  it('scales each filament to what was measured of its material', () => {
    const { input } = slicedPrintInput(
      sliced,
      ['pla', 'petg'],
      [
        { material: 'pla', amount: 24 },
        { material: 'petg', amount: 3 },
      ],
    )
    expect(input.objects.map(({ amounts }) => amounts)).toEqual([
      [20, 0],
      [0, 2.5],
    ])
  })

  it('scales the overhead with its filament', () => {
    const { input } = slicedPrintInput(
      sliced,
      ['pla', 'petg'],
      [
        { material: 'pla', amount: 24 },
        { material: 'petg', amount: 3 },
      ],
    )
    expect(input.overhead).toEqual([4, 0.5])
  })

  it('scales every filament alike when a measured material is not on the plate', () => {
    const result = slicedPrintInput(sliced, ['pla', 'petg'], [{ material: 'abs', amount: 36 }])
    expect(result.input.objects.map(({ amounts }) => amounts)).toEqual([
      [20, 0],
      [0, 10],
    ])
  })

  it('scales every filament alike when a filament the file used was not measured', () => {
    expect(total(slicedPrintInput(sliced, ['pla', 'petg'], [{ material: 'pla', amount: 27 }]))).toBeCloseTo(27, 9)
  })

  it('merges slots of one material', () => {
    expect(slicedPrintInput(sliced, ['pla', 'pla'], [{ material: 'pla', amount: 36 }]).materials).toEqual(['pla'])
  })

  it('adds a merged material’s slots together', () => {
    const { input } = slicedPrintInput(sliced, ['pla', 'pla'], [{ material: 'pla', amount: 36 }])
    expect(input.objects.map(({ amounts }) => amounts)).toEqual([[20], [10]])
  })

  it('keeps what was measured of a material the file barely used as its overhead', () => {
    const { input } = slicedPrintInput(
      { ...sliced, objects: [{ requestId: 'hull', amounts: [10, 0] }], overhead: [2, 0] },
      ['pla', 'petg'],
      [
        { material: 'pla', amount: 12 },
        { material: 'petg', amount: 4 },
      ],
    )
    expect(input.overhead).toEqual([2, 4])
  })

  it('charges nothing from a stopped print’s file when nothing was measured', () => {
    expect(total(slicedPrintInput({ ...sliced, cut: true }, ['pla', 'petg'], []))).toBe(0)
  })

  it('keeps the file’s figures when nothing was measured', () => {
    expect(slicedPrintInput(sliced, ['pla', 'petg'], []).input.objects.map(({ amounts }) => amounts)).toEqual([
      [10, 0],
      [0, 5],
    ])
  })

  it('keeps each object on its print', () => {
    expect(slicedPrintInput(sliced, ['pla', 'petg'], []).input.objects.map(({ requestId }) => requestId)).toEqual(['hull', 'turret'])
  })
})

describe('wantsSlicedFile', () => {
  const now = 10 * 60 * 60_000
  const ended = job({ runId: '7', plateId: 'plate', endedAt: now - 60_000 })
  const recording = (fields: Partial<PlateRecording>): PlateRecording => ({
    transactionId: 'tx',
    source: 'printer',
    method: 'volume',
    unit: 'g',
    minutes: 60,
    otherAmount: 0,
    overheadAmount: 0,
    recordedAt: 1,
    ...fields,
  })

  it('wants a finished print’s file for a plate not recorded yet', () => {
    expect(wantsSlicedFile(ended, [plate()], now)).toBe(true)
  })

  it('wants a finished print’s file for the plate it recorded itself', () => {
    expect(wantsSlicedFile({ ...ended, transactionId: 'tx' }, [plate({ recording: recording({}) })], now)).toBe(true)
  })

  it('leaves a plate recorded from a slicer file alone', () => {
    expect(wantsSlicedFile(ended, [plate({ recording: recording({ source: 'file', transactionId: 'mine' }) })], now)).toBe(false)
  })

  it('leaves a plate recorded from typed totals alone', () => {
    expect(
      wantsSlicedFile(
        { ...ended, transactionId: 'tx' },
        [plate({ recording: recording({ source: 'totals', transactionId: 'typed' }) })],
        now,
      ),
    ).toBe(false)
  })

  it('wants a failed print’s file once its waste is recorded', () => {
    expect(wantsSlicedFile({ ...ended, outcome: 'failed', transactionId: 'waste' }, [plate()], now)).toBe(true)
  })

  it('leaves a failed print with no recorded waste alone', () => {
    expect(wantsSlicedFile({ ...ended, outcome: 'failed' }, [plate()], now)).toBe(false)
  })

  it('leaves a print still printing alone', () => {
    expect(wantsSlicedFile({ ...ended, outcome: 'printing' }, [plate()], now)).toBe(false)
  })

  it('leaves a print linked to no plate alone', () => {
    expect(wantsSlicedFile({ ...ended, plateId: undefined }, [plate()], now)).toBe(false)
  })

  it('leaves a print without a run alone', () => {
    expect(wantsSlicedFile({ ...ended, runId: undefined }, [plate()], now)).toBe(false)
  })

  it('asks for a file once', () => {
    expect(wantsSlicedFile({ ...ended, slicedPlate: 'unreadable' }, [plate()], now)).toBe(false)
  })

  it('stops asking after a while', () => {
    expect(wantsSlicedFile({ ...ended, endedAt: now - SLICED_FILE_WAIT_MS - 1 }, [plate()], now)).toBe(false)
  })
})
