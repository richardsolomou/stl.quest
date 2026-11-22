import { PLATE_RETRY_STAGE, type Plate } from '../core/plates'
import type { PrintJobOutcome } from '../core/printJobs'

export type BoardPlate = Pick<Plate, 'id' | 'number' | 'stage' | 'startedAt' | 'items'> & { print?: { outcome: PrintJobOutcome } }
export type CardPlate = { id: string; number: number; failed?: boolean }

/**
 * The plate each card wears: the running plate holding a print's copies in that stage, or, back in Up next, the plate
 * whose print failed or was cancelled, when that plate is the newest the print was on.
 */
export function cardPlates(plates: BoardPlate[]) {
  const cards = new Map<string, CardPlate>()
  const newest = new Map<string, BoardPlate>()
  for (const plate of [...plates].sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0)))
    for (const { requestId } of plate.items) {
      if (plate.stage) cards.set(`${requestId}:${plate.stage}`, { id: plate.id, number: plate.number })
      if (plate.number > (newest.get(requestId)?.number ?? 0)) newest.set(requestId, plate)
    }
  for (const [requestId, plate] of newest) {
    const key = `${requestId}:${PLATE_RETRY_STAGE}`
    const outcome = plate.print?.outcome
    if (!plate.stage && (outcome === 'failed' || outcome === 'cancelled') && !cards.has(key))
      cards.set(key, { id: plate.id, number: plate.number, failed: true })
  }
  return (requestId: string, status: string) => cards.get(`${requestId}:${status}`)
}
