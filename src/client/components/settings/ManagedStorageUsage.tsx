import { Progress } from '@/components/ui/progress'
import { formatBytes } from '../../../core/format'
import { useI18n } from '../../i18n'

export type ManagedStorageUsageValue = {
  usedOrReservedBytes: number
  availableBytes: number
  quotaBytes: number
}

export function ManagedStorageUsage({ usage, className }: { usage: ManagedStorageUsageValue; className?: string }) {
  const { t: messages, locale } = useI18n()
  const t = messages.storage.usage
  return (
    <div className={className}>
      <Progress value={(usage.usedOrReservedBytes / usage.quotaBytes) * 100} aria-label={t.label} />
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>{t.usedOrReserved(formatBytes(usage.usedOrReservedBytes, locale))}</span>
        <span>{t.available(formatBytes(usage.availableBytes, locale))}</span>
      </div>
    </div>
  )
}
