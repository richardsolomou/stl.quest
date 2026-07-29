import { Progress } from '@/components/ui/progress'
import { formatBytes } from '../../../core/format'

export type ManagedStorageUsageValue = {
  usedOrReservedBytes: number
  availableBytes: number
  quotaBytes: number
}

export function ManagedStorageUsage({ usage, className }: { usage: ManagedStorageUsageValue; className?: string }) {
  return (
    <div className={className}>
      <Progress value={(usage.usedOrReservedBytes / usage.quotaBytes) * 100} aria-label="Managed storage usage" />
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>{formatBytes(usage.usedOrReservedBytes)} used or reserved</span>
        <span>{formatBytes(usage.availableBytes)} available</span>
      </div>
    </div>
  )
}
