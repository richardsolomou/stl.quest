import type { PublicPrintRequest } from './types'

export const RESIN_ESTIMATE_DESCRIPTION = 'Estimated solid model volume; supports and slicer settings are not included.'

export function resinVolumeMl(request: Pick<PublicPrintRequest, 'estimatedResinMl' | 'printer'>, count = 1) {
  return request.printer?.technology !== 'sla' || request.estimatedResinMl === undefined || request.estimatedResinMl <= 0
    ? undefined
    : request.estimatedResinMl * count
}

export function summarizeResinMl(entries: { request: Pick<PublicPrintRequest, 'estimatedResinMl' | 'printer'>; count: number }[]) {
  let knownMl = 0
  let unknownCopies = 0
  let slaCopies = 0
  for (const entry of entries) {
    if (entry.request.printer?.technology !== 'sla') continue
    slaCopies += entry.count
    const volume = resinVolumeMl(entry.request, entry.count)
    if (volume === undefined) unknownCopies += entry.count
    else knownMl += volume
  }
  return { knownMl, unknownCopies, slaCopies }
}

export function formatResinMl(volumeMl: number) {
  if (volumeMl > 0 && volumeMl < 0.1) return '<0.1'
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: volumeMl < 10 ? 1 : 0,
  }).format(volumeMl)
}
