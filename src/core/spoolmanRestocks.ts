import type { SpoolmanFilament, SpoolmanMatch } from './spoolman'

/**
 * Spools STL Quest asks the Spoolman bridge to add to Spoolman, such as a restock from a pasted order of a filament
 * Spoolman manages. STL Quest never reaches into the user's network, so the bridge collects them with the workspace's
 * ingest token, adds each to Spoolman, and reports the spool it made; the new spool's stock then arrives like any other.
 */

export const SPOOLMAN_RESTOCK_STATUSES = ['queued', 'created', 'failed'] as const
export type SpoolmanRestockStatus = (typeof SPOOLMAN_RESTOCK_STATUSES)[number]

/** The most spools waiting at once, and the most settled ones the workspace keeps to show. */
export const MAX_SPOOLMAN_RESTOCKS = 200
/** The most spools one order line adds. */
export const MAX_RESTOCK_SPOOLS = 50
/** The most queued spools one collection hands the bridge. */
export const SPOOLMAN_RESTOCK_BATCH = 50

export type SpoolmanRestock = {
  id: string
  filamentId: number
  /** The Spoolman filament's name when queued, to show while the spool waits. */
  filamentName?: string
  /** Net grams on the spool; Spoolman takes the filament's own weight without it. */
  grams?: number
  status: SpoolmanRestockStatus
  /** The spool the bridge made in Spoolman. */
  spoolId?: number
  /** Why Spoolman refused it, as the bridge reported. */
  error?: string
  createdAt: number
  updatedAt: number
}

/** What the bridge reports after trying to add a queued spool. */
export type SpoolmanRestockResult = { id: string } & ({ spoolId: number } | { error: string })

/**
 * The text the bridge writes into a spool's comment in Spoolman. A bridge whose report was lost finds the spool by it
 * on its next try, so a retry never adds a second spool. The bridge spells it out itself, so change both together.
 */
export function restockMarker(id: string) {
  return `stlquest-restock:${id}`
}

/**
 * The Spoolman filament a restock of a library filament adds a spool of: of the Spoolman filaments counting towards it,
 * the one with the most spools in use, then the lowest ID.
 */
export function restockFilament(consumableId: string, filaments: SpoolmanFilament[], matches: Map<number, SpoolmanMatch>) {
  return filaments
    .filter((filament) => matches.get(filament.id)?.consumableId === consumableId)
    .sort((left, right) => right.spools - left.spools || left.id - right.id)[0]
}
