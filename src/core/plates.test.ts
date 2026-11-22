import { describe, expect, it } from 'vitest'
import type { Consumable } from './consumables'
import {
  coveringPlateTransaction,
  heldByPlates,
  matchSlicedObjects,
  plateBrokenBy,
  plateMoves,
  plateStart,
  plateUsageDrafts,
  printingPlate,
  slicedObjectStem,
  splitPlate,
  splitWeights,
  supersededByPlate,
  type Plate,
  type PlatePrint,
} from './plates'
import type { PrinterProfile } from './types'
import type { UsageEvent } from './usage'

const hull = { requestId: 'hull', name: 'Chimera hull', fileName: 'Chimera_Hull_Uncut_repaired.stl' }
const turret = { requestId: 'turret', name: 'Turret', fileName: 'Chrimera_Turret.stl' }

describe('slicedObjectStem', () => {
  it('drops the model extension', () => {
    expect(slicedObjectStem('Chrimera_Turret.stl')).toBe('chrimera_turret')
  })

  it('drops what a cut adds after the extension', () => {
    expect(slicedObjectStem('Chimera_Hull_Uncut_repaired.stl_B_A')).toBe('chimera_hull_uncut_repaired')
  })

  it('drops a connector the slicer added after the extension', () => {
    expect(slicedObjectStem('Chimera_Hull_Uncut_repaired.stl-Dowel-Connector-1')).toBe('chimera_hull_uncut_repaired')
  })

  it('drops cut-part suffixes from a name without an extension', () => {
    expect(slicedObjectStem('Turret_B_A')).toBe('turret')
  })

  it('drops the path of a model kept in a folder', () => {
    expect(slicedObjectStem('parts/Turret.3mf')).toBe('turret')
  })
})

describe('matchSlicedObjects', () => {
  it('matches an object to the print whose model has its name', () => {
    expect(matchSlicedObjects([{ name: 'Chrimera_Turret.stl' }], [hull, turret])).toEqual(['turret'])
  })

  it('matches every cut part and connector of one model to its print', () => {
    expect(
      matchSlicedObjects(
        [{ name: 'Chimera_Hull_Uncut_repaired.stl_A' }, { name: 'Chimera_Hull_Uncut_repaired.stl-Dowel-Connector-2' }],
        [hull, turret],
      ),
    ).toEqual(['hull', 'hull'])
  })

  it('ignores case', () => {
    expect(matchSlicedObjects([{ name: 'chimera_hull_uncut_REPAIRED.STL' }], [hull])).toEqual(['hull'])
  })

  it('falls back to the print name', () => {
    expect(matchSlicedObjects([{ name: 'Turret' }], [{ requestId: 'linked', name: 'Turret' }])).toEqual(['linked'])
  })

  it('matches an object by the request tag a plate file named it with', () => {
    expect(matchSlicedObjects([{ name: 'SQ-12 Chrimera_Turret.stl' }], [hull, { ...turret, number: 12 }])).toEqual(['turret'])
  })

  it('prefers the tag over a file name that fits another print', () => {
    expect(matchSlicedObjects([{ name: 'SQ-12 Chrimera_Turret.stl' }], [{ ...hull, number: 12 }, turret])).toEqual(['hull'])
  })

  it('falls back to the file name when the tag names no print on the plate', () => {
    expect(matchSlicedObjects([{ name: 'SQ-99 Chrimera_Turret.stl' }], [hull, { ...turret, number: 12 }])).toEqual(['turret'])
  })

  it('leaves an object of a model not on the plate unmatched', () => {
    expect(matchSlicedObjects([{ name: 'Benchy.stl' }], [hull, turret])).toEqual([undefined])
  })

  it('leaves an object without a name unmatched', () => {
    expect(matchSlicedObjects([{}], [hull])).toEqual([undefined])
  })

  it('prefers the longest model name that fits', () => {
    expect(
      matchSlicedObjects(
        [{ name: 'Hull_Bolter.stl' }],
        [
          { requestId: 'hull', name: 'Hull', fileName: 'Hull.stl' },
          { requestId: 'bolter', name: 'Bolter', fileName: 'Hull_Bolter.stl' },
        ],
      ),
    ).toEqual(['bolter'])
  })
})

describe('splitWeights', () => {
  const sized = (requestId: string, copies: number, volumeMm3?: number, estimatedMaterial?: number): PlatePrint => ({
    requestId,
    copies,
    volumeMm3,
    estimatedMaterial,
  })

  it('weighs prints by model volume times copies when every print has one', () => {
    expect(splitWeights([sized('a', 2, 1_000, 5), sized('b', 1, 3_000, 1)])).toEqual({ method: 'volume', weights: [2_000, 3_000] })
  })

  it('weighs prints by their material estimate when a volume is missing', () => {
    expect(splitWeights([sized('a', 2, undefined, 5), sized('b', 1, 3_000, 1)])).toEqual({ method: 'estimate', weights: [10, 1] })
  })

  it('splits evenly by copies when an estimate is missing too', () => {
    expect(splitWeights([sized('a', 2), sized('b', 1, 3_000, 1)])).toEqual({ method: 'even', weights: [2, 1] })
  })
})

describe('splitPlate from slicer amounts', () => {
  const prints: PlatePrint[] = [
    { requestId: 'hull', copies: 1 },
    { requestId: 'turret', copies: 2 },
  ]
  const measured = {
    objects: [
      { requestId: 'hull', amounts: [60] },
      { requestId: 'hull', amounts: [20] },
      { requestId: 'turret', amounts: [10] },
      { amounts: [10] },
    ],
    overhead: [10],
  }

  it('marks the split measured', () => {
    expect(splitPlate(measured, 100, prints, 1).method).toBe('measured')
  })

  it('adds up every object of a print and its share of the overhead', () => {
    expect(splitPlate(measured, 100, prints, 1).prints[0].amounts).toEqual([88])
  })

  it('keeps objects not in STL Quest and their overhead share off the prints', () => {
    expect(splitPlate(measured, 100, prints, 1).other.amounts).toEqual([11])
  })

  it('splits print time by each print’s share of the material', () => {
    expect(splitPlate(measured, 100, prints, 1).prints.map(({ minutes }) => minutes)).toEqual([80, 10])
  })

  it('keeps the time of what is not in STL Quest unattributed', () => {
    expect(splitPlate(measured, 100, prints, 1).other.minutes).toBe(10)
  })

  it('reports the overhead it spread', () => {
    expect(splitPlate(measured, 100, prints, 1).overhead).toBe(10)
  })

  it('never spreads negative overhead from a final retraction', () => {
    expect(splitPlate({ ...measured, overhead: [-0.01] }, 100, prints, 1).prints[0].amounts).toEqual([80])
  })

  it('takes each filament slot on its own', () => {
    const split = splitPlate(
      {
        objects: [
          { requestId: 'hull', amounts: [10, 0] },
          { requestId: 'turret', amounts: [0, 5] },
        ],
        overhead: [0, 5],
      },
      60,
      prints,
      2,
    )
    expect(split.prints.map(({ amounts }) => amounts)).toEqual([
      [10, 0],
      [0, 10],
    ])
  })
})

describe('splitPlate from typed totals', () => {
  const prints: PlatePrint[] = [
    { requestId: 'a', copies: 1, volumeMm3: 3_000 },
    { requestId: 'b', copies: 1, volumeMm3: 1_000 },
  ]

  it('splits material by the prints’ weights', () => {
    expect(splitPlate({ total: 40, otherShare: 0 }, 60, prints, 1).prints.map(({ amounts }) => amounts[0])).toEqual([30, 10])
  })

  it('names the method the weights used', () => {
    expect(splitPlate({ total: 40, otherShare: 0 }, 60, prints, 1).method).toBe('volume')
  })

  it('keeps the share of other stuff on the plate unattributed', () => {
    expect(splitPlate({ total: 40, otherShare: 0.25 }, 60, prints, 1).other.amounts).toEqual([10])
  })

  it('splits time like the material', () => {
    expect(splitPlate({ total: 40, otherShare: 0.25 }, 60, prints, 1).prints.map(({ minutes }) => minutes)).toEqual([33.75, 11.25])
  })
})

describe('plateUsageDrafts', () => {
  const printer: PrinterProfile = { id: 'x1', name: 'X1', printType: 'filament', powerWatts: 100 }
  const pla: Consumable = { id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 20 }
  const sheet: Consumable = {
    id: 'sheet',
    kind: 'part',
    name: 'Sheet',
    printType: 'filament',
    price: 50,
    lifespan: 100,
    lifespanUnit: 'plates',
  }
  const split = splitPlate(
    { objects: [{ requestId: 'a', amounts: [30] }, { amounts: [10] }], overhead: [0] },
    60,
    [{ requestId: 'a', copies: 2 }],
    1,
  )
  const drafts = plateUsageDrafts(split, {
    plateId: 'plate',
    rates: { electricityPricePerKwh: 0.3 },
    printer,
    materials: [pla],
    consumables: [pla, sheet],
  })
  const of = (requestId: string | undefined, unit: string) => drafts.find((draft) => draft.requestId === requestId && draft.unit === unit)

  it('records each print’s material at its measured amount', () => {
    expect(of('a', 'g')).toMatchObject({ consumableId: 'pla', amount: 30, copies: 2, stage: 'printing', kind: 'use' })
  })

  it('records each print’s printer time', () => {
    expect(of('a', 'minute')).toMatchObject({ printerId: 'x1', amount: 45 })
  })

  it('wears a part by the plate in proportion to the print’s share of the run', () => {
    expect(of('a', 'plate')).toMatchObject({ consumableId: 'sheet', amount: 0.75 })
  })

  it('records what is not in STL Quest without a print', () => {
    expect(of(undefined, 'g')).toMatchObject({ consumableId: 'pla', amount: 10 })
  })

  it('tags every event with the plate', () => {
    expect(drafts.every((draft) => draft.plateId === 'plate')).toBe(true)
  })

  it('never marks plate usage estimated', () => {
    expect(drafts.some((draft) => draft.estimated)).toBe(false)
  })
})

function event(id: string, fields: Partial<UsageEvent>): UsageEvent {
  return { id, transactionId: id, stage: 'printing', kind: 'use', requestId: 'a', amount: 1, unit: 'g', copies: 2, createdAt: 1, ...fields }
}

describe('supersededByPlate', () => {
  it('replaces the step recorded for the copies on the plate', () => {
    expect(supersededByPlate([event('step', {})], 'a', 2, 'plate-tx')).toEqual(['step'])
  })

  it('keeps a step for more copies than the plate holds', () => {
    expect(supersededByPlate([event('backfill', { copies: 6, estimated: true })], 'a', 2, 'plate-tx')).toEqual([])
  })

  it('replaces the newest steps that fit first', () => {
    expect(supersededByPlate([event('older', { createdAt: 1 }), event('newer', { createdAt: 2 })], 'a', 2, 'plate-tx')).toEqual(['newer'])
  })

  it('keeps a failed run, which used material of its own', () => {
    expect(supersededByPlate([event('failed', { outcome: 'failed' })], 'a', 2, 'plate-tx')).toEqual([])
  })

  it('keeps finishing', () => {
    expect(supersededByPlate([event('wash', { stage: 'finishing' })], 'a', 2, 'plate-tx')).toEqual([])
  })

  it('keeps another plate’s usage', () => {
    expect(supersededByPlate([event('other', { plateId: 'other' })], 'a', 2, 'plate-tx')).toEqual([])
  })

  it('replaces only the print’s own events of a shared transaction', () => {
    expect(
      supersededByPlate(
        [event('mine', { transactionId: 'fill' }), event('theirs', { transactionId: 'fill', requestId: 'b' })],
        'a',
        2,
        'plate-tx',
      ),
    ).toEqual(['mine'])
  })

  it('counts copies the plate already replaced', () => {
    expect(
      supersededByPlate(
        [event('replaced', { undoneAt: 5, supersededBy: 'plate-tx' }), event('step', { createdAt: 3 })],
        'a',
        2,
        'plate-tx',
      ),
    ).toEqual([])
  })
})

describe('coveringPlateTransaction', () => {
  const plate = (id: string, copies: number, transactionId?: string): Plate => ({
    id,
    number: 1,
    otherStuff: false,
    items: [{ requestId: 'a', copies }],
    createdAt: 1,
    updatedAt: 1,
    ...(transactionId && {
      recording: {
        transactionId,
        source: 'file',
        method: 'measured',
        unit: 'g',
        minutes: 1,
        otherAmount: 0,
        overheadAmount: 0,
        recordedAt: 1,
      },
    }),
  })

  it('names the recorded plate a later step for its copies belongs to', () => {
    expect(coveringPlateTransaction([plate('p', 2, 'plate-tx')], [], 'a', 2)).toBe('plate-tx')
  })

  it('leaves a step alone when the plate is not recorded', () => {
    expect(coveringPlateTransaction([plate('p', 2)], [], 'a', 2)).toBeUndefined()
  })

  it('leaves a step alone once the plate’s copies are covered', () => {
    expect(
      coveringPlateTransaction([plate('p', 2, 'plate-tx')], [event('step', { undoneAt: 2, supersededBy: 'plate-tx' })], 'a', 2),
    ).toBeUndefined()
  })

  it('leaves a step for more copies than the plate holds alone', () => {
    expect(coveringPlateTransaction([plate('p', 2, 'plate-tx')], [], 'a', 3)).toBeUndefined()
  })
})

const run = (fields: Partial<Plate> = {}): Plate => ({
  id: 'run',
  number: 4,
  printerId: 'x2d',
  otherStuff: false,
  items: [
    { requestId: 'hull', copies: 2 },
    { requestId: 'turret', copies: 1 },
  ],
  stage: 'in_progress',
  startedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  ...fields,
})

describe('plateStart', () => {
  it('runs copies from the queue in Printing', () => {
    expect(plateStart([{ requestId: 'hull', status: 'todo', copies: 2 }])?.stage).toBe('in_progress')
  })

  it('moves copies that are not printing yet', () => {
    expect(
      plateStart([
        { requestId: 'hull', status: 'up_next', copies: 2 },
        { requestId: 'turret', status: 'in_progress', copies: 1 },
      ])?.moves,
    ).toEqual([{ id: 'hull', from: 'up_next', to: 'in_progress', count: 2 }])
  })

  it('adds up a print’s copies from different stages', () => {
    expect(
      plateStart([
        { requestId: 'hull', status: 'todo', copies: 2 },
        { requestId: 'hull', status: 'up_next', copies: 1 },
      ])?.items,
    ).toEqual([{ requestId: 'hull', copies: 3 }])
  })

  it('records a plate of finished copies without running it', () => {
    expect(plateStart([{ requestId: 'hull', status: 'done', copies: 1 }])).toEqual({
      items: [{ requestId: 'hull', copies: 1 }],
      moves: [],
    })
  })

  it('refuses a plate of finished and unfinished copies', () => {
    expect(
      plateStart([
        { requestId: 'hull', status: 'done', copies: 1 },
        { requestId: 'turret', status: 'todo', copies: 1 },
      ]),
    ).toBeUndefined()
  })
})

describe('heldByPlates', () => {
  it('counts the copies running plates hold in a stage', () => {
    expect(heldByPlates([run(), run({ id: 'other', items: [{ requestId: 'hull', copies: 3 }] })], 'hull', 'in_progress')).toBe(5)
  })

  it('ignores plates running in another stage', () => {
    expect(heldByPlates([run({ stage: 'post_processing' })], 'hull', 'in_progress')).toBe(0)
  })

  it('ignores plates that are not running', () => {
    expect(heldByPlates([run({ stage: undefined })], 'hull', 'in_progress')).toBe(0)
  })
})

describe('plateBrokenBy', () => {
  const counts = { hull: { in_progress: 3 }, turret: { in_progress: 1 } }

  it('finds the plate a move would take copies from', () => {
    expect(plateBrokenBy([run()], [{ id: 'hull', from: 'in_progress', count: 2 }], (id) => counts[id as keyof typeof counts])?.id).toBe(
      'run',
    )
  })

  it('lets copies off a plate move on their own', () => {
    expect(
      plateBrokenBy([run()], [{ id: 'hull', from: 'in_progress', count: 1 }], (id) => counts[id as keyof typeof counts]),
    ).toBeUndefined()
  })

  it('adds up several moves of the same print', () => {
    expect(
      plateBrokenBy(
        [run()],
        [
          { id: 'hull', from: 'in_progress', count: 1 },
          { id: 'hull', from: 'in_progress', count: 1 },
        ],
        (id) => counts[id as keyof typeof counts],
      )?.id,
    ).toBe('run')
  })
})

describe('plateMoves', () => {
  const counts = { hull: { in_progress: 3 }, turret: { in_progress: 1 } }
  const countsOf = (id: string) => counts[id as keyof typeof counts]

  it('moves every print on the plate', () => {
    expect(plateMoves(run(), 'post_processing', countsOf).moves).toEqual([
      { id: 'hull', from: 'in_progress', to: 'post_processing', count: 2 },
      { id: 'turret', from: 'in_progress', to: 'post_processing', count: 1 },
    ])
  })

  it('keeps the plate running in Finishing', () => {
    expect(plateMoves(run(), 'post_processing', countsOf).stage).toBe('post_processing')
  })

  it('ends the run once its prints are ready', () => {
    expect(plateMoves(run({ stage: 'post_processing' }), 'done', () => ({ post_processing: 2 })).stage).toBeUndefined()
  })

  it('moves only the copies still there', () => {
    expect(plateMoves(run(), 'post_processing', () => ({ in_progress: 1 })).moves.map(({ count }) => count)).toEqual([1, 1])
  })
})

describe('printingPlate', () => {
  it('finds the plate printing on the printer', () => {
    expect(printingPlate([run({ stage: 'post_processing' }), run({ id: 'now' })], 'x2d', new Set())?.id).toBe('now')
  })

  it('takes the plate started last', () => {
    expect(printingPlate([run({ id: 'old', startedAt: 1 }), run({ id: 'new', startedAt: 2 })], 'x2d', new Set())?.id).toBe('new')
  })

  it('skips a plate a print is already linked to', () => {
    expect(printingPlate([run({ id: 'done' })], 'x2d', new Set(['done']))).toBeUndefined()
  })
})
