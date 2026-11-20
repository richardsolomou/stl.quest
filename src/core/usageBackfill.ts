import { consumablesOfKind, type Consumable } from './consumables'
import type { PriceCalculatorSettings } from './priceCalculator'
import { automaticEstimateFields, requestPrintEstimate, type MaterialEstimateSettings } from './printEstimates'
import type { PrinterProfile, PrintRequest } from './types'
import { stepUsageDrafts, type UsageDraft } from './usage'
import { isReadyStatus } from './workflow'

/**
 * Usage is recorded from the moment a workspace tracks it, so prints finished before then are filled in once from their
 * estimates: a past print with copies Ready, or archived, and no live usage records its printing step as the step sheet
 * would, at today's prices, dated when it was done and marked estimated so it counts as spend but never as stock or wear.
 */

export type BackfillRequest = Pick<
  PrintRequest,
  | 'id'
  | 'quantity'
  | 'counts'
  | 'completedAt'
  | 'archivedAt'
  | 'updatedAt'
  | 'printerId'
  | 'requestedPrintType'
  | 'modelDimensions'
  | 'modelVolumeMm3'
  | 'modelSurfaceAreaMm2'
  | 'estimatedMaterialOverride'
  | 'estimatedPrintMinutesOverride'
>

export type BackfilledPrint = { requestId: string; copies: number; usedAt: number; drafts: UsageDraft[] }

export type UsageBackfillSummary = { prints: number; copies: number; events: number; from?: number; to?: number }

/**
 * The printing step each past print would have recorded: its estimate times its Ready copies (every copy once
 * archived) on its assigned printer while that is still in use, with the first material of its print type in the
 * library, the one quotes default to. A print without a print type, a full estimate, or anything to record is skipped.
 */
export function usageBackfill(
  requests: BackfillRequest[],
  resolved: {
    rates: Pick<PriceCalculatorSettings, 'electricityPricePerKwh'> & MaterialEstimateSettings
    printers: PrinterProfile[]
    consumables: Consumable[]
    /** Prints with live usage, which keep what was recorded. */
    recorded: ReadonlySet<string>
  },
): BackfilledPrint[] {
  return requests.flatMap((request) => {
    const copies = backfillCopies(request)
    if (copies === 0 || resolved.recorded.has(request.id)) return []
    const assigned = resolved.printers.find(({ id }) => id === request.printerId)
    const printType = assigned?.printType ?? request.requestedPrintType
    if (!printType) return []
    const estimate = requestPrintEstimate({
      printType,
      estimatedMaterialOverride: request.estimatedMaterialOverride,
      estimatedPrintMinutesOverride: request.estimatedPrintMinutesOverride,
      ...automaticEstimateFields(request, printType, resolved.rates),
    })
    if (!((estimate?.material ?? 0) > 0 && (estimate?.minutes ?? 0) > 0)) return []
    const printer = assigned?.archived ? undefined : assigned
    const drafts = stepUsageDrafts(
      { requestId: request.id, stage: 'printing', copies, ...(printer && { printerId: printer.id }) },
      {
        rates: resolved.rates,
        printer,
        estimate,
        material: consumablesOfKind(resolved.consumables, printType)[0],
        equipment: [],
        consumables: resolved.consumables,
      },
    )
    if (drafts.length === 0) return []
    return [
      {
        requestId: request.id,
        copies,
        usedAt: request.completedAt ?? request.archivedAt ?? request.updatedAt,
        drafts: drafts.map((draft) => ({ ...draft, estimated: true })),
      },
    ]
  })
}

export function backfillSummary(prints: BackfilledPrint[]): UsageBackfillSummary {
  return {
    prints: prints.length,
    copies: prints.reduce((total, print) => total + print.copies, 0),
    events: prints.reduce((total, print) => total + print.drafts.length, 0),
    ...(prints.length > 0 && {
      from: prints.reduce((earliest, { usedAt }) => Math.min(earliest, usedAt), Infinity),
      to: prints.reduce((latest, { usedAt }) => Math.max(latest, usedAt), -Infinity),
    }),
  }
}

/** The copies that reached Ready, or every copy of an archived print that has none there. */
function backfillCopies(request: Pick<BackfillRequest, 'counts' | 'archivedAt' | 'quantity'>) {
  const ready = Object.entries(request.counts).reduce((total, [status, count]) => (isReadyStatus(status) ? total + count : total), 0)
  return ready > 0 ? ready : request.archivedAt !== undefined ? request.quantity : 0
}
