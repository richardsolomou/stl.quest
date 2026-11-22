import type { FilamentConsumable } from './consumables'
import { heldByPlates, printingPlate, type Plate, type PlateMeasured } from './plates'
import { taggedRequestNumber } from './request'
import type { SlicedPlate } from './slicedPlate'
import { sameText } from './spoolman'

/**
 * Prints a printer actually ran, as Bambuddy (github.com/maziggy/bambuddy) reports them through its generic webhook.
 * STL Quest only reads them: it never sends a print anywhere. Each print links to the plate run it was, so that run's
 * usage uses the measured hours and grams and its outcome counts towards the printer's failures; one that links to
 * nothing waits in a list to be attached or marked personal.
 */

/** Request bodies above this are refused before they are parsed; Bambuddy can attach a base64 photo. */
export const MAX_PRINT_EVENT_BODY_BYTES = 4 * 1024 * 1024
/** The most prints one workspace keeps; the oldest go first. */
export const MAX_PRINT_JOBS = 2_000

export const PRINT_JOB_OUTCOMES = ['printing', 'finished', 'failed', 'cancelled'] as const
export type PrintJobOutcome = (typeof PRINT_JOB_OUTCOMES)[number]
export type EndedOutcome = Exclude<PrintJobOutcome, 'printing'>

/** What one print event says, with Bambuddy's display strings read into numbers. */
export type PrintReport = {
  outcome: PrintJobOutcome
  printerName: string
  /** The job's name in the slicer (Bambuddy's subtask name), else its file name. */
  fileName?: string
  minutes?: number
  grams?: number
  /** Bambuddy's per-tray breakdown, such as `AMS1 T1 PLA: 12.3g | AMS1 T2 PETG: 4.0g`, kept as it reads. */
  filamentDetails?: string
  reason?: string
  /** Percent done, for a print that stopped part way. */
  progress?: number
  archiveId?: string
  runId?: string
}

/** Grams Bambuddy charged one Spoolman spool for a print. */
export type PrintSpoolUsage = { spoolId: number; grams: number }
/** The most spools one print reports; a printer holds a few AMS units of four trays. */
export const MAX_PRINT_SPOOLS = 32

/**
 * What a print used per Spoolman spool, which the Spoolman bridge reads from Bambuddy's usage history and sends with
 * the run ID Bambuddy's end event carried, since the webhook itself only describes it in words.
 */
export type PrintUsageReport = { runId: string; spools: PrintSpoolUsage[] }

/**
 * What a print's sliced file from Bambuddy's archive says each object used, per filament the plate uses, with each
 * object on the print it matched or on none.
 */
export type PrintSlicedPlate = {
  filaments: { type?: string; color?: string }[]
  objects: { requestId?: string; amounts: number[] }[]
  overhead: number[]
  /** The slicer's print time, for a finished print the printer reported no duration for. */
  minutes?: number
  /**
   * For a print that did not finish: true when the amounts stop where it stopped, false when the file has no progress
   * markers to tell, so they are the whole plate's and only weigh the prints against each other.
   */
  cut?: boolean
}

/** The most a sliced file the bridge sends may be; Bambu Studio's `.gcode.3mf` of a full plate is a few tens of MB. */
export const MAX_SLICED_FILE_BYTES = 64 * 1024 * 1024
/** How long after a print ends STL Quest still asks the bridge for its sliced file. */
export const SLICED_FILE_WAIT_MS = 24 * 60 * 60_000
/** The most prints one ask for sliced files names. */
export const MAX_SLICED_FILES_WANTED = 10

export type PrintJob = Omit<PrintReport, 'outcome'> & {
  id: string
  outcome: PrintJobOutcome
  /** The STL Quest printer of the same name, when there is exactly one. */
  printerId?: string
  plateId?: string
  /** Marked as not for any request, so it leaves the unlinked list. */
  personal: boolean
  /** What it used per Spoolman spool, once the bridge reported it. */
  filamentUsage?: PrintSpoolUsage[]
  /** Its sliced file, once the bridge sent it, or that the file it sent could not be read or it could not get one. */
  slicedPlate?: PrintSlicedPlate | 'unreadable' | 'unavailable'
  /** The usage its end recorded, so a repeated event never records it twice. */
  transactionId?: string
  startedAt?: number
  endedAt?: number
  receivedAt: number
}

export type PrintJobChanges = Partial<Omit<PrintJob, 'id'>>

/** Bambuddy's generic webhook JSON, as far as STL Quest reads it; every value is a display string. */
export type BambuddyEvent = {
  event: string
  printer?: string
  filename?: string
  duration?: string
  filament_grams?: string
  filament_details?: string
  reason?: string
  progress?: string
  archive_id?: string
  run_id?: string
}

const OUTCOMES: Record<string, PrintJobOutcome> = {
  print_start: 'printing',
  print_complete: 'finished',
  print_failed: 'failed',
  print_stopped: 'cancelled',
}

/** Bambuddy writes "Unknown" for anything it does not know. */
const known = (value?: string) => {
  const trimmed = value?.trim()
  return trimmed && trimmed.toLowerCase() !== 'unknown' ? trimmed : undefined
}

/** A Bambuddy duration such as `1h 23m` or `45m`, in minutes. */
export function displayedMinutes(text?: string) {
  const match = /^(?:(\d+)h\s*)?(\d+)m$/.exec(known(text) ?? '')
  return match ? Number(match[1] ?? 0) * 60 + Number(match[2]) : undefined
}

/** Bambuddy's grams, such as `12.3`. */
export function displayedGrams(text?: string) {
  const match = /^(\d+(?:\.\d+)?)\s*g?$/i.exec(known(text) ?? '')
  return match ? Number(match[1]) : undefined
}

export type DisplayedTray = { material?: string; grams: number }

/** The tray label (`AMS-A T1`, `Ext`) Bambuddy puts before the material of a spool it measured. */
const TRAY_LABEL = /^(?:Ext|.+?\sT\d+)\s+/

/**
 * Bambuddy's per-tray breakdown read into each tray's material and grams: `AMS-A T1 PLA: 12.3g | Ext PETG: 4.0g` from
 * the spools it tracked, or `PLA: 12.3g` from the sliced file's filament slots.
 */
export function displayedTrays(text?: string): DisplayedTray[] {
  return (known(text) ?? '').split('|').flatMap((part) => {
    const match = /^(.*?):\s*(\d+(?:\.\d+)?)\s*g$/i.exec(part.trim())
    if (!match) return []
    const material = known(match[1].replace(TRAY_LABEL, ''))
    return [{ ...(material && { material }), grams: Number(match[2]) }]
  })
}

/**
 * What a print used of each library filament: each tray goes to the first filament of its material, else the first
 * filament. Labelled trays are what Bambuddy measured, so they are the whole print; the print's grams are the slicer's
 * estimate, so only grams the slicer's own slots leave out go to the first filament.
 */
export function printFilaments(
  job: Pick<PrintJob, 'grams' | 'filamentDetails'>,
  filaments: FilamentConsumable[],
  materialOf: (filament: FilamentConsumable) => string | undefined,
): { filament: FilamentConsumable; grams: number }[] {
  const first = filaments[0]
  if (!first) return []
  const used = new Map<FilamentConsumable, number>()
  const add = (filament: FilamentConsumable, grams: number) => {
    if (grams > 0) used.set(filament, (used.get(filament) ?? 0) + grams)
  }
  const trays = displayedTrays(job.filamentDetails)
  for (const { material, grams } of trays) add(filaments.find((filament) => sameText(materialOf(filament), material)) ?? first, grams)
  const measured = job.filamentDetails?.split('|').some((part) => TRAY_LABEL.test(part.trim()))
  if (!measured) {
    // Bambuddy rounds every figure to a tenth of a gram, so n slots can miss the rounded total by up to n × 0.05 g.
    const untracked = Math.round(((job.grams ?? 0) - trays.reduce((total, { grams }) => total + grams, 0)) * 10) / 10
    if (untracked > trays.length * 0.05) add(first, untracked)
  }
  return [...used].map(([filament, grams]) => ({ filament, grams }))
}

/** The print event a Bambuddy notification is, or none for notifications that are not about a print's start or end. */
export function bambuddyReport(event: BambuddyEvent): PrintReport | undefined {
  const outcome = OUTCOMES[event.event]
  const printerName = known(event.printer)
  if (!outcome || !printerName) return undefined
  const fileName = known(event.filename)
  const minutes = displayedMinutes(event.duration)
  const grams = displayedGrams(event.filament_grams)
  const filamentDetails = known(event.filament_details)
  const reason = known(event.reason)
  const progress = Number(known(event.progress))
  const archiveId = known(event.archive_id)
  const runId = known(event.run_id)
  return {
    outcome,
    printerName,
    ...(fileName && { fileName }),
    ...(minutes !== undefined && { minutes }),
    ...(grams !== undefined && { grams }),
    ...(filamentDetails && { filamentDetails }),
    ...(reason && { reason }),
    ...(Number.isFinite(progress) && progress >= 0 && progress <= 100 && { progress }),
    ...(archiveId && { archiveId }),
    ...(runId && { runId }),
  }
}

const sameName = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase()

/** The printer Bambuddy names, matched by name, when exactly one active printer has it. */
export function printerNamed<Printer extends { id: string; name: string; archived?: boolean }>(printers: Printer[], name: string) {
  const named = printers.filter((printer) => !printer.archived && sameName(printer.name, name))
  return named.length === 1 ? named[0] : undefined
}

export type PrintJobLink = { plateId: string; by: 'printer' | 'tag' } | { requestId: string; by: 'tag' }

/**
 * Which plate run a print was: the plate printing on its printer that no other print is linked to, else the plate
 * holding the request its name is tagged with (the one printing, else the newest not recorded yet) whose run has not
 * ended. A tagged request on no such plate is only suggested, for someone to attach.
 */
export function printJobLink(
  job: Pick<PrintJob, 'id' | 'printerId' | 'fileName'>,
  plates: Plate[],
  requests: { id: string; number: number }[],
  jobs: PrintJob[],
): PrintJobLink | undefined {
  const others = jobs.filter(({ id, plateId }) => id !== job.id && plateId)
  const linked = new Set(others.map(({ plateId }) => plateId!))
  const printing = job.printerId ? printingPlate(plates, job.printerId, linked) : undefined
  if (printing) return { plateId: printing.id, by: 'printer' }
  const number = taggedRequestNumber(job.fileName)
  const request = number === undefined ? undefined : requests.find((candidate) => candidate.number === number)
  if (!request) return undefined
  const ended = new Set(others.filter(({ outcome }) => outcome !== 'printing').map(({ plateId }) => plateId!))
  const holding = plates.filter((plate) => !ended.has(plate.id) && plate.items.some((item) => item.requestId === request.id))
  const plate =
    holding.find((candidate) => heldByPlates([candidate], request.id, 'in_progress') > 0) ??
    holding.filter((candidate) => !candidate.recording).sort((left, right) => right.number - left.number)[0]
  return plate ? { plateId: plate.id, by: 'tag' } : { requestId: request.id, by: 'tag' }
}

export type PrinterRunCount = { printerId: string; runs: number; failed: number }

/**
 * Each printer's plate runs that Bambuddy reported finished or failed, and how many failed. A stopped print is someone's
 * choice, not the printer failing, so it is not a run here.
 */
export function printerRunCounts(jobs: PrintJob[]): PrinterRunCount[] {
  const counts = new Map<string, PrinterRunCount>()
  for (const { printerId, plateId, outcome } of jobs) {
    if (!printerId || !plateId || (outcome !== 'finished' && outcome !== 'failed')) continue
    const count = counts.get(printerId) ?? { printerId, runs: 0, failed: 0 }
    count.runs += 1
    if (outcome === 'failed') count.failed += 1
    counts.set(printerId, count)
  }
  return [...counts.values()]
}

/**
 * The print an event continues: the one with the same Bambuddy run, else the latest still printing on the same printer
 * under the same name, since Bambuddy's start event carries no run ID.
 */
export function continuedPrintJob(jobs: PrintJob[], report: PrintReport) {
  if (report.runId) {
    const same = jobs.find((job) => job.runId === report.runId)
    if (same) return same
  }
  if (report.outcome === 'printing') return undefined
  return jobs
    .filter(
      (job) =>
        job.outcome === 'printing' &&
        !job.runId &&
        sameName(job.printerName, report.printerName) &&
        (job.fileName ?? '') === (report.fileName ?? ''),
    )
    .sort((left, right) => right.receivedAt - left.receivedAt)[0]
}

/** Whether two reports of a print's spools say the same, in any order. */
export function sameSpoolUsage(left: PrintSpoolUsage[] | undefined, right: PrintSpoolUsage[]) {
  const key = (usage: PrintSpoolUsage[]) =>
    usage
      .map(({ spoolId, grams }) => `${spoolId}:${grams}`)
      .toSorted()
      .join(',')
  return left !== undefined && key(left) === key(right)
}

/**
 * The library filaments a print's spools charge, each with its grams: a spool counts towards the filament its Spoolman
 * filament matches, else `fallback`, and spools of the same filament add up. A spool with neither is left out.
 */
export function printSpoolMaterials<Material extends { id: string }>(
  usage: PrintSpoolUsage[],
  context: {
    spools: { id: number; filamentId: number }[]
    matches: Map<number, { consumableId: string }>
    library: Material[]
    fallback?: Material
  },
) {
  const totals = new Map<Material, number>()
  for (const { spoolId, grams } of usage) {
    const filamentId = context.spools.find(({ id }) => id === spoolId)?.filamentId
    const consumableId = filamentId === undefined ? undefined : context.matches.get(filamentId)?.consumableId
    const material = context.library.find(({ id }) => id === consumableId) ?? context.fallback
    if (material && grams > 0) totals.set(material, (totals.get(material) ?? 0) + grams)
  }
  return { materials: [...totals.keys()], totals: [...totals.values()] }
}

/**
 * Whether STL Quest wants an ended print's sliced file: a print of a plate run, ended lately, whose usage it recorded
 * itself. A plate recorded from a slicer file or typed totals keeps that, so its print's file is never fetched.
 */
export function wantsSlicedFile(job: PrintJob, plates: Plate[], now: number) {
  if (!job.runId || !job.plateId || job.slicedPlate || job.outcome === 'printing') return false
  if (job.endedAt === undefined || now - job.endedAt > SLICED_FILE_WAIT_MS) return false
  if (job.outcome !== 'finished') return Boolean(job.transactionId)
  const plate = plates.find(({ id }) => id === job.plateId)
  return Boolean(plate) && (!plate!.recording || plate!.recording.transactionId === job.transactionId)
}

/** A sliced plate as a print keeps it, with what was printed by then for a print that `stopped`. */
export function printSlicedPlate(plate: SlicedPlate, assignments: (string | undefined)[], stopped: boolean): PrintSlicedPlate {
  const slots = plate.filaments.map(({ slot }) => slot)
  const source = stopped && plate.printed ? plate.printed : { objects: plate.objects.map(({ grams }) => grams), overhead: plate.overhead }
  return {
    filaments: plate.filaments.map(({ type, color }) => ({ ...(type && { type }), ...(color && { color }) })),
    objects: plate.objects.map((_, index) => ({
      ...(assignments[index] && { requestId: assignments[index] }),
      amounts: slots.map((slot) => source.objects[index][slot] ?? 0),
    })),
    overhead: slots.map((slot) => source.overhead[slot] ?? 0),
    ...(stopped ? { cut: Boolean(plate.printed) } : plate.minutes !== undefined && { minutes: plate.minutes }),
  }
}

/**
 * A sliced plate's figures as a plate recording, with what was measured winning: slots of one material become one,
 * and each material's objects and overhead are scaled to what was measured of it. When the measured materials and
 * the file's do not line up, every figure is scaled by the measured total instead. With nothing measured, a finished
 * print's figures stand, and a stopped print's are zero, as the printer measured none of its waste.
 */
export function slicedPrintInput<Material>(
  sliced: PrintSlicedPlate,
  slotMaterials: Material[],
  measured: { material: Material; amount: number }[],
): { input: PlateMeasured; materials: Material[] } {
  const materials = [...new Set(slotMaterials)]
  const column = slotMaterials.map((material) => materials.indexOf(material))
  const merged = (amounts: number[]) =>
    materials.map((_, index) => amounts.reduce((total, amount, slot) => (column[slot] === index ? total + Math.max(0, amount) : total), 0))
  const objects = sliced.objects.map(({ requestId, amounts }) => ({ ...(requestId && { requestId }), amounts: merged(amounts) }))
  const overhead = merged(sliced.overhead)
  const fileAmounts = materials.map((_, index) => objects.reduce((total, object) => total + object.amounts[index], overhead[index]))
  const measuredAmounts = materials.map((material) =>
    measured.reduce((total, entry) => (entry.material === material ? total + entry.amount : total), 0),
  )
  const measuredTotal = measured.reduce((total, { amount }) => total + amount, 0)
  const fileTotal = fileAmounts.reduce((total, amount) => total + amount, 0)
  const byMaterial =
    measured.every(({ material }) => materials.includes(material)) &&
    fileAmounts.every((amount, index) => amount === 0 || measuredAmounts[index] > 0)
  const scale = materials.map((_, index) => {
    if (measuredTotal <= 0) return sliced.cut === undefined ? 1 : 0
    if (byMaterial) return fileAmounts[index] > 0 ? measuredAmounts[index] / fileAmounts[index] : 0
    return fileTotal > 0 ? measuredTotal / fileTotal : 0
  })
  return {
    materials,
    input: {
      objects: objects.map((object) => ({ ...object, amounts: object.amounts.map((amount, index) => amount * scale[index]) })),
      // A material measured but hardly in the file still counts, spread over the prints like purge.
      overhead: overhead.map((amount, index) =>
        measuredTotal > 0 && byMaterial && fileAmounts[index] === 0 ? measuredAmounts[index] : amount * scale[index],
      ),
    },
  }
}

/**
 * What a plate's dialog says about its print's sliced file: that a stopped print's waste stops where it did, that the
 * file could not show where, or that it could not be read. A finished print's recording already says it.
 */
export function slicedFileNote(job: Pick<PrintJob, 'slicedPlate'>): 'cut' | 'whole' | 'unreadable' | undefined {
  if (job.slicedPlate === 'unreadable') return 'unreadable'
  if (typeof job.slicedPlate !== 'object' || job.slicedPlate.cut === undefined) return undefined
  return job.slicedPlate.cut ? 'cut' : 'whole'
}
