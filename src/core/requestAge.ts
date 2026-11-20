const minute = 60_000
const hour = 60 * minute
const day = 24 * hour
const week = 7 * day

/** How long a copy may wait before the board calls its age out. */
const HOT_AGE = week

export type AgeUnit = { value: number; unit: 'minute' | 'hour' | 'day' | 'week' }

/** The largest whole unit that keeps an age readable in a few characters on a ticket. */
export function ageUnit(elapsed: number): AgeUnit {
  if (elapsed < hour) return { value: Math.max(1, Math.floor(elapsed / minute)), unit: 'minute' }
  if (elapsed < day) return { value: Math.floor(elapsed / hour), unit: 'hour' }
  if (elapsed < 2 * week) return { value: Math.floor(elapsed / day), unit: 'day' }
  return { value: Math.floor(elapsed / week), unit: 'week' }
}

export function isAgeHot(elapsed: number) {
  return elapsed >= HOT_AGE
}
