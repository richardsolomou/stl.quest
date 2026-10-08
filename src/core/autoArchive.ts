import type { PrintRequest } from './types'
import { workflow } from './workflow'

export const MAX_AUTO_ARCHIVE_DAYS = 365
export const DEFAULT_AUTO_ARCHIVE_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export function validAutoArchiveDays(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_AUTO_ARCHIVE_DAYS
}

type AutoArchiveCandidate = Pick<PrintRequest, 'id' | 'counts' | 'completedAt' | 'archivedAt'>

/** A request is due once every copy is Ready and the last one arrived at least `days` whole days ago. */
export function autoArchiveDue(requests: AutoArchiveCandidate[], days: number, now: number): string[] {
  const ready = workflow.statuses.at(-1)!.id
  const cutoff = now - days * DAY_MS
  return requests
    .filter(
      (request) =>
        request.archivedAt === undefined &&
        request.completedAt !== undefined &&
        request.completedAt <= cutoff &&
        (request.counts[ready] ?? 0) > 0 &&
        workflow.statuses.every((status) => status.id === ready || (request.counts[status.id] ?? 0) === 0),
    )
    .map(({ id }) => id)
}
