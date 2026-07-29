export const storagePlans = {
  free: { name: 'Free', quotaBytes: 1_000_000_000, monthlyPrice: 0 },
  supporter: { name: 'Supporter', quotaBytes: 25_000_000_000, monthlyPrice: 5 },
  pro: { name: 'Pro', quotaBytes: 100_000_000_000, monthlyPrice: 10 },
} as const

export type StoragePlan = keyof typeof storagePlans

export function storagePlan(value: string | undefined): StoragePlan {
  return value === 'supporter' || value === 'pro' ? value : 'free'
}
