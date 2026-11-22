export const USAGE_TRACKING_SETTING = 'usage-tracking'

/** Where an admin switched tracking: its setting, or one of the invitations placed where it pays off. */
export const USAGE_TRACKING_SOURCES = ['settings', 'consumables', 'spend', 'maintenance', 'quest', 'spoolman'] as const
export type UsageTrackingSource = (typeof USAGE_TRACKING_SOURCES)[number]

/** Whether the workspace records what each step uses, which stock, maintenance, and spend are counted from; off until an admin turns it on. */
export async function storedUsageTracking(repository: { getSetting<T>(key: string): Promise<T | undefined> }) {
  return (await repository.getSetting<unknown>(USAGE_TRACKING_SETTING)) === true
}
