import type { PartConsumable } from './consumables'
import type { UsageEvent } from './usage'

export type PartWear = {
  /** Plates or print hours, in the part's lifespan unit, since it was last replaced on the printer. */
  used: number
  lifespan: number
  unit: PartConsumable['lifespanUnit']
  /** When it was last replaced on the printer; absent when the log has no replacement. */
  replacedAt?: number
  due: boolean
}

/**
 * How worn one part is on one printer, from the printer's own printing events since the part's last `replace` there:
 * every copy it printed counts as a plate, failed runs included as they wore the part too, and its printing minutes
 * count as hours. Undone events count for nothing, and neither do estimates of past prints, since no replacement before
 * them was ever recorded.
 */
export function partWear(events: UsageEvent[], printerId: string, part: PartConsumable): PartWear {
  const live = events.filter((event) => !event.undoneAt && !event.estimated && event.printerId === printerId)
  const replacements = live.filter((event) => event.kind === 'replace' && event.consumableId === part.id).map((event) => event.createdAt)
  const replacedAt = replacements.length ? Math.max(...replacements) : undefined
  const runs = live.filter(
    (event) =>
      event.kind === 'use' &&
      event.stage === 'printing' &&
      event.unit === 'minute' &&
      event.consumableId === undefined &&
      (replacedAt === undefined || event.createdAt > replacedAt),
  )
  const used =
    part.lifespanUnit === 'plates'
      ? runs.reduce((total, event) => total + (event.copies ?? 1), 0)
      : runs.reduce((total, event) => total + event.amount, 0) / 60
  return {
    used,
    lifespan: part.lifespan,
    unit: part.lifespanUnit,
    ...(replacedAt !== undefined && { replacedAt }),
    due: part.lifespan > 0 && used >= part.lifespan,
  }
}
