export const storagePlans = {
  free: { name: 'Free', quotaBytes: 1_000_000_000, monthlyPrice: 0 },
  supporter: { name: 'Supporter', quotaBytes: 25_000_000_000, monthlyPrice: 5 },
  pro: { name: 'Pro', quotaBytes: 100_000_000_000, monthlyPrice: 10 },
} as const

export type StoragePlan = keyof typeof storagePlans

export function storagePlan(value: string | undefined): StoragePlan {
  return value === 'supporter' || value === 'pro' ? value : 'free'
}

export type StorageUsageLevel = 'ok' | 'nearing' | 'full'

export function storageUsageLevel(usedBytes: number, quotaBytes: number): StorageUsageLevel {
  if (quotaBytes <= 0) return 'full'
  const used = usedBytes / quotaBytes
  if (used >= 1) return 'full'
  return used >= 0.8 ? 'nearing' : 'ok'
}

export function nextStoragePlan(plan: StoragePlan): StoragePlan | undefined {
  return (Object.keys(storagePlans) as StoragePlan[])
    .filter((candidate) => storagePlans[candidate].quotaBytes > storagePlans[plan].quotaBytes)
    .sort((a, b) => storagePlans[a].quotaBytes - storagePlans[b].quotaBytes)[0]
}

export function highestStoragePlan(values: Iterable<string | undefined>): StoragePlan {
  return Array.from(values, storagePlan).reduce(
    (current, candidate) => (storagePlans[candidate].quotaBytes > storagePlans[current].quotaBytes ? candidate : current),
    'free',
  )
}
