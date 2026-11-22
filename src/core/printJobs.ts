import { heldByPlates, printingPlate, type Plate } from './plates'

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

export type PrintJob = Omit<PrintReport, 'outcome'> & {
  id: string
  outcome: PrintJobOutcome
  /** The STL Quest printer of the same name, when there is exactly one. */
  printerId?: string
  plateId?: string
  /** Marked as not for any request, so it leaves the unlinked list. */
  personal: boolean
  /** The usage its end recorded, so a repeated event never records it twice. */
  transactionId?: string
  startedAt?: number
  endedAt?: number
  receivedAt: number
}

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

/** The request number of the one `SQ-<n>` tag in a job or file name, which downloads from STL Quest carry. */
export function taggedRequestNumber(name?: string) {
  const tags = [...new Set([...(name ?? '').matchAll(/(?<![\p{L}\p{N}])SQ-(\d{1,9})(?!\p{N})/giu)].map((match) => Number(match[1])))]
  return tags.length === 1 ? tags[0] : undefined
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

export type PrinterRunCount = { printerId: string; runs: number; failed: number; cancelled: number }

/** Each printer's ended plate runs as Bambuddy reported them, and how many failed or were cancelled. */
export function printerRunCounts(jobs: PrintJob[]): PrinterRunCount[] {
  const counts = new Map<string, PrinterRunCount>()
  for (const { printerId, plateId, outcome } of jobs) {
    if (!printerId || !plateId || outcome === 'printing') continue
    const count = counts.get(printerId) ?? { printerId, runs: 0, failed: 0, cancelled: 0 }
    count.runs += 1
    if (outcome === 'failed') count.failed += 1
    if (outcome === 'cancelled') count.cancelled += 1
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
