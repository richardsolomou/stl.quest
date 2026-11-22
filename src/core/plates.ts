import { wearPartsFor, type Consumable } from './consumables'
import { printerCostPerMinute, type CostedPrinter, type PriceCalculatorSettings } from './priceCalculator'
import { taggedRequestNumber } from './request'
import { consumed, priced, supplied, type UsageDraft, type UsageEvent } from './usage'
import { workflow, type StatusId } from './workflow'

/**
 * A plate is what went on one run of a printer. The slicer knows the run's totals, and a labelled slicer file knows what
 * each object on it used, so recording a plate splits the run across its prints: by the slicer's own per-object amounts
 * when the file has them, otherwise by each print's model volume, then its material estimate, then evenly by copies.
 * Print time follows each print's share of the material. What the plate's prints did not use (objects that are not in
 * STL Quest) is recorded without a print, so stock and spend still count it but no print is charged for it.
 *
 * A plate started from the board is a run: its copies move to Printing together, then through Finishing as one, and
 * copies it holds only leave with it. Copies the run does not hold, even of the same print, move on their own.
 */

export const MAX_PLATE_PRINTS = 100
export const MAX_PLATE_OBJECTS = 1_000
export const MAX_PLATE_FILAMENTS = 32
/**
 * The most stored model data one plate file is built from, each model counted once however many copies it has, which
 * bounds how much a build reads and how long a slicer waits; each model's conversion memory has its own budget.
 */
export const MAX_PLATE_FILE_BYTES = 256 * 1024 * 1024

/**
 * What a plate's combined file is saved as, which slicers take as the project's name. OrcaSlicer also names the only
 * object of a 3MF it did not write after the file, and its copies keep that name, so a one-model plate is named after
 * the model to keep its tag.
 */
export function plateFileName(number: number, objectNames: string[]) {
  if (objectNames.length === 1) return `${objectNames[0].replace(/\.[^.\s]+$/, '')}.3mf`
  return `stlquest-plate-${number}.3mf`
}

export const PLATE_SPLIT_METHODS = ['measured', 'volume', 'estimate', 'even'] as const
export type PlateSplitMethod = (typeof PLATE_SPLIT_METHODS)[number]
/** Where a recording came from: a slicer file, totals typed from its summary, or what the printer reported. */
export const PLATE_SOURCES = ['file', 'totals', 'printer'] as const
export type PlateSource = (typeof PLATE_SOURCES)[number]

export type PlateItem = { requestId: string; copies: number; amount?: number; minutes?: number }

/** The stages a running plate's copies sit in together; the run ends when they move anywhere else. */
export const PLATE_RUN_STAGES = ['in_progress', 'post_processing'] as const
export type PlateRunStage = (typeof PLATE_RUN_STAGES)[number]

export function isPlateRunStage(status: string): status is PlateRunStage {
  return (PLATE_RUN_STAGES as readonly string[]).includes(status)
}

export type PlateRecording = {
  transactionId: string
  source: PlateSource
  method: PlateSplitMethod
  unit: 'g' | 'ml'
  minutes: number
  /** Material on the plate that no print used, overhead share included. */
  otherAmount: number
  /** Material extruded outside any object (purge, prime tower, flushing), already spread into the amounts. */
  overheadAmount: number
  recordedAt: number
}

export type Plate = {
  id: string
  number: number
  printerId?: string
  /** Things not in STL Quest share the plate, so typed totals keep a share of it unattributed. */
  otherStuff: boolean
  items: PlateItem[]
  recording?: PlateRecording
  /** Where its copies are while it runs; absent once the run is over, or for a plate recorded after the fact. */
  stage?: PlateRunStage
  startedAt?: number
  createdAt: number
  updatedAt: number
}

/** A library material, or one outside the library named and priced on the spot (per kg of filament or litre of resin). */
export type PlateMaterialChoice = { consumableId: string } | { name: string; price?: number }

/** A slicer file's amounts: each object's material per filament slot, assigned to a print or to none. */
export type PlateMeasured = { objects: { requestId?: string; amounts: number[] }[]; overhead: number[] }
/**
 * A plate's total per filament slot, typed from the slicer summary or reported by the printer, with the share of it that
 * went to things not in STL Quest.
 */
export type PlateTotals = { totals: number[]; otherShare: number }

export type PlateRecordInput = { plateId: string; minutes: number; materials: PlateMaterialChoice[] } & (PlateMeasured | PlateTotals)

export function isMeasured(input: PlateMeasured | PlateTotals): input is PlateMeasured {
  return 'objects' in input
}

/** What a print on the plate can be weighed by when the slicer did not say what it used. */
export type PlatePrint = {
  requestId: string
  copies: number
  /** What a slicer file recorded on the plate measured for this print's copies there. */
  measuredAmount?: number
  volumeMm3?: number
  estimatedMaterial?: number
}

export type PlateSplit = {
  method: PlateSplitMethod
  prints: { requestId: string; copies: number; amounts: number[]; minutes: number }[]
  other: { amounts: number[]; minutes: number }
  overhead: number
}

const MODEL_EXTENSION = /\.(stl|3mf|obj|step|stp|amf|ply|oltp)(?=$|[^a-z0-9])/i
/** What slicers append to a cut or duplicated object: `_A`, `_B_A`, ` (2)`, `-1`. */
const SLICER_SUFFIX = /(?:_[a-z]|\s*\(\d+\)|-\d+)+$/i
/** The `SQ-<n> ` that downloads and plate files put in front of a model's name. */
const REQUEST_TAG_PREFIX = /^SQ-\d+\s+/i

/**
 * A slicer object's name reduced to the model it came from: lower case, without a folder, and without the extension
 * or anything a cut, connector, or copy added after it.
 */
export function slicedObjectStem(label: string) {
  const name = (label.trim().split(/[\\/]/).at(-1) ?? '').replace(REQUEST_TAG_PREFIX, '')
  const extension = MODEL_EXTENSION.exec(name)
  const stem = extension ? name.slice(0, extension.index) : name.replace(SLICER_SUFFIX, '')
  return stem.trim().toLowerCase()
}

/**
 * The print each object belongs to: by the request tag its name carries, which every copy, cut, and split of a model
 * downloaded or opened from STL Quest keeps, else by its model's file name, else the print's name. When several names
 * fit, the longest wins, so `Hull_Bolter` is not taken for `Hull`. A tag of a request not on the plate falls back to
 * the names.
 */
export function matchSlicedObjects(
  objects: { name?: string }[],
  prints: { requestId: string; number?: number; name: string; fileName?: string }[],
): (string | undefined)[] {
  const stems = prints
    .flatMap(({ requestId, name, fileName }) => [
      ...(fileName ? [{ requestId, stem: slicedObjectStem(fileName) }] : []),
      { requestId, stem: slicedObjectStem(name) },
    ])
    .filter(({ stem }) => stem)
    .sort((left, right) => right.stem.length - left.stem.length)
  return objects.map(({ name }) => {
    if (!name) return undefined
    const tag = taggedRequestNumber(name)
    const tagged = tag === undefined ? undefined : prints.find(({ number }) => number === tag)
    if (tagged) return tagged.requestId
    const stem = slicedObjectStem(name)
    return stems.find((candidate) => candidate.stem === stem)?.requestId
  })
}

/**
 * How the prints share a plate total: by what a slicer file measured when all have it, else by model volume, else by
 * estimate, else by copies.
 */
export function splitWeights(prints: PlatePrint[]): { method: PlateSplitMethod; weights: number[] } {
  if (prints.every(({ measuredAmount }) => positive(measuredAmount)))
    return { method: 'measured', weights: prints.map(({ measuredAmount }) => measuredAmount!) }
  if (prints.every(({ volumeMm3 }) => positive(volumeMm3)))
    return { method: 'volume', weights: prints.map(({ volumeMm3, copies }) => volumeMm3! * copies) }
  if (prints.every(({ estimatedMaterial }) => positive(estimatedMaterial)))
    return { method: 'estimate', weights: prints.map(({ estimatedMaterial, copies }) => estimatedMaterial! * copies) }
  return { method: 'even', weights: prints.map(({ copies }) => copies) }
}

/** Splits the plate's material per filament slot and its time across the prints, keeping other stuff's share apart. */
export function splitPlate(input: PlateMeasured | PlateTotals, minutes: number, prints: PlatePrint[], slots: number): PlateSplit {
  const zero = () => Array.from({ length: slots }, () => 0)
  const amounts = prints.map(zero)
  const other = zero()
  const index = new Map(prints.map(({ requestId }, position) => [requestId, position]))
  let method: PlateSplitMethod = 'measured'
  let overhead = 0
  if (isMeasured(input)) {
    for (let slot = 0; slot < slots; slot++) {
      for (const object of input.objects) {
        const amount = Math.max(0, object.amounts[slot] ?? 0)
        const position = object.requestId === undefined ? undefined : index.get(object.requestId)
        if (position === undefined) other[slot] += amount
        else amounts[position][slot] += amount
      }
      const spread = Math.max(0, input.overhead[slot] ?? 0)
      overhead += spread
      const used = amounts.reduce((total, print) => total + print[slot], other[slot])
      // A slot used only for purging takes the shares the prints have across every slot.
      const shares = used > 0 ? [...amounts.map((print) => print[slot]), other[slot]] : [...amounts.map(sum), sum(other)]
      const total = sum(shares)
      shares.forEach((share, position) => {
        const part = total > 0 ? (spread * share) / total : position === shares.length - 1 ? spread : 0
        if (position < amounts.length) amounts[position][slot] += part
        else other[slot] += part
      })
    }
  } else {
    const { method: weighed, weights } = splitWeights(prints)
    method = weighed
    const weight = sum(weights)
    for (let slot = 0; slot < slots; slot++) {
      const total = Math.max(0, input.totals[slot] ?? 0)
      const attributed = weight > 0 ? total * (1 - input.otherShare) : 0
      weights.forEach((share, position) => (amounts[position][slot] = weight > 0 ? (attributed * share) / weight : 0))
      other[slot] = total - attributed
    }
  }
  const material = amounts.reduce((total, print) => total + sum(print), sum(other))
  const copies = sum(prints.map((print) => print.copies))
  const minutesOf = (share: number, copyShare: number) =>
    material > 0 ? (minutes * share) / material : copies > 0 ? minutes * copyShare : 0
  return {
    method,
    prints: prints.map((print, position) => ({
      requestId: print.requestId,
      copies: print.copies,
      amounts: amounts[position],
      minutes: minutesOf(sum(amounts[position]), print.copies / copies),
    })),
    other: { amounts: other, minutes: minutesOf(sum(other), 0) },
    overhead,
  }
}

/**
 * The events a recorded plate appends: per print and for what is not in STL Quest, the printer's minutes, its wear parts
 * (by the minute, or by the plate in proportion to the share of the run), and the material of each slot.
 */
export function plateUsageDrafts(
  split: PlateSplit,
  resolved: {
    plateId: string
    rates: Pick<PriceCalculatorSettings, 'electricityPricePerKwh'>
    printer?: CostedPrinter
    /** The material of each filament slot. */
    materials: Consumable[]
    consumables: Consumable[]
  },
): UsageDraft[] {
  const { plateId, rates, printer } = resolved
  const wear = printer ? wearPartsFor(resolved.consumables, printer.printType, printer) : []
  const runMinutes = split.prints.reduce((total, print) => total + print.minutes, split.other.minutes)
  const shares = [...split.prints, { requestId: undefined, copies: undefined, ...split.other }]
  return shares.flatMap(({ requestId, copies, amounts, minutes }) => {
    const base = { stage: 'printing' as const, kind: 'use' as const, plateId, ...(requestId && { requestId, copies }) }
    const drafts: UsageDraft[] = []
    if (printer && minutes > 0) {
      drafts.push({ ...base, printerId: printer.id, amount: minutes, unit: 'minute', ...priced(printerCostPerMinute(rates, printer)) })
      for (const part of wear) {
        const used = supplied(part)
        const amount = used.unit === 'plate' ? (runMinutes > 0 ? minutes / runMinutes : 0) : minutes
        if (amount > 0) drafts.push({ ...base, printerId: printer.id, ...used, amount })
      }
    }
    amounts.forEach((amount, slot) => {
      const material = resolved.materials[slot]
      if (material && amount > 0) drafts.push({ ...base, ...(printer && { printerId: printer.id }), ...consumed(material), amount })
    })
    return drafts
  })
}

/** A print's live step-sheet or filled-in printing usage, by transaction, newest first. */
function printingSteps(events: UsageEvent[], requestId: string) {
  const steps = new Map<string, { ids: string[]; copies: number; createdAt: number }>()
  for (const event of events) {
    if (
      event.requestId !== requestId ||
      event.stage !== 'printing' ||
      event.kind !== 'use' ||
      event.undoneAt ||
      event.plateId ||
      event.outcome === 'failed'
    )
      continue
    const step = steps.get(event.transactionId) ?? { ids: [], copies: event.copies ?? 0, createdAt: event.createdAt }
    step.ids.push(event.id)
    steps.set(event.transactionId, step)
  }
  return [...steps.values()].sort((left, right) => right.createdAt - left.createdAt)
}

/** Copies of a print whose earlier printing usage the plate's transaction already replaced. */
function coveredCopies(events: UsageEvent[], requestId: string, transactionId: string) {
  const covered = new Map<string, number>()
  for (const event of events)
    if (event.requestId === requestId && event.supersededBy === transactionId) covered.set(event.transactionId, event.copies ?? 0)
  return sum([...covered.values()])
}

/**
 * The plate's measured numbers win: recording it replaces the print's printing usage from the step sheet or a fill-in
 * for the copies on the plate, newest step first, taking only steps whose copies all fit, so usage of other copies and
 * failed runs stay. `events` is the print's printing usage, undone events included.
 */
export function supersededByPlate(events: UsageEvent[], requestId: string, copies: number, transactionId: string) {
  let remaining = copies - coveredCopies(events, requestId, transactionId)
  const ids: string[] = []
  for (const step of printingSteps(events, requestId)) {
    if (step.copies < 1 || step.copies > remaining) continue
    ids.push(...step.ids)
    remaining -= step.copies
  }
  return ids
}

/**
 * The transaction of the recorded plate a printing step recorded after it belongs to, so the step is kept but never
 * counted: the newest plate holding the print with enough of its copies not yet matched to a step.
 */
export function coveringPlateTransaction(plates: Plate[], events: UsageEvent[], requestId: string, copies: number) {
  return [...plates]
    .sort((left, right) => (right.recording?.recordedAt ?? 0) - (left.recording?.recordedAt ?? 0))
    .flatMap((plate) => {
      const transactionId = plate.recording?.transactionId
      const item = plate.items.find((candidate) => candidate.requestId === requestId)
      return transactionId && item && item.copies - coveredCopies(events, requestId, transactionId) >= copies ? [transactionId] : []
    })[0]
}

export type PlateCopies = { requestId: string; status: StatusId; copies: number }
export type PlateCopyMove = { id: string; from: StatusId; to: StatusId; count: number }

const printing = 'in_progress' satisfies PlateRunStage
/** Where a plate's copies go back to when its print fails or is cancelled, to be printed again. */
export const PLATE_RETRY_STAGE: StatusId = 'up_next'
const stageIndex = (status: StatusId) => workflow.statuses.findIndex(({ id }) => id === status)

/**
 * What starting a plate from selected copies does: copies not past Printing start a run there, and a plate of copies
 * all past it records a run that already happened. A mix of both is refused, as is a stage the workflow lacks.
 */
export function plateStart(copies: PlateCopies[]): { items: PlateItem[]; moves: PlateCopyMove[]; stage?: PlateRunStage } | undefined {
  const indexes = copies.map(({ status }) => stageIndex(status))
  if (copies.length === 0 || indexes.some((index) => index < 0)) return undefined
  const runs = indexes.map((index) => index <= stageIndex(printing))
  if (runs.some((value) => value !== runs[0])) return undefined
  const items = new Map<string, number>()
  for (const { requestId, copies: count } of copies) items.set(requestId, (items.get(requestId) ?? 0) + count)
  return {
    items: [...items].map(([requestId, count]) => ({ requestId, copies: count })),
    moves: runs[0]
      ? copies
          .filter(({ status }) => status !== printing)
          .map(({ requestId, status, copies: count }) => ({ id: requestId, from: status, to: printing, count }))
      : [],
    ...(runs[0] && { stage: printing }),
  }
}

/** Copies of a print that running plates hold in a stage. */
export function heldByPlates(plates: Plate[], requestId: string, status: StatusId) {
  return sum(
    plates.flatMap((plate) =>
      plate.stage === status ? plate.items.filter((item) => item.requestId === requestId).map(({ copies }) => copies) : [],
    ),
  )
}

/** The running plate that moving these copies on their own would take copies from, so it has to move as one instead. */
export function plateBrokenBy(
  plates: Plate[],
  moves: Omit<PlateCopyMove, 'to'>[],
  countsOf: (requestId: string) => Record<StatusId, number> | undefined,
) {
  const taken = new Map<string, number>()
  for (const { id, from, count } of moves) taken.set(`${id}\0${from}`, (taken.get(`${id}\0${from}`) ?? 0) + count)
  for (const [key, count] of taken) {
    const [requestId, status] = key.split('\0')
    const left = (countsOf(requestId)?.[status] ?? 0) - count
    if (left < heldByPlates(plates, requestId, status))
      return plates.find((plate) => plate.stage === status && plate.items.some((item) => item.requestId === requestId))
  }
  return undefined
}

/**
 * Moving a running plate: each print's copies on it, or as many as are left where it runs, and the stage it runs in
 * after, none once its prints leave Printing and Finishing.
 */
export function plateMoves(
  plate: Plate,
  to: StatusId,
  countsOf: (requestId: string) => Record<StatusId, number> | undefined,
): { moves: PlateCopyMove[]; stage?: PlateRunStage } {
  const from = plate.stage
  if (!from || from === to) return { moves: [] }
  return {
    moves: plate.items.flatMap(({ requestId, copies }) => {
      const count = Math.min(copies, countsOf(requestId)?.[from] ?? 0)
      return count > 0 ? [{ id: requestId, from, to, count }] : []
    }),
    ...(isPlateRunStage(to) && { stage: to }),
  }
}

/**
 * The plate printing on a printer now: the one started last of those in Printing that no print is linked to yet, since
 * a plate's run is one print and a later one on the printer is a different run.
 */
export function printingPlate(plates: Plate[], printerId: string, linked: ReadonlySet<string>) {
  return plates
    .filter((plate) => plate.stage === printing && plate.printerId === printerId && !linked.has(plate.id))
    .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0))[0]
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function positive(value?: number): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0
}
