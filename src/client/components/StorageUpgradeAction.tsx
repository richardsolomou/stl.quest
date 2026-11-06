import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowUpCircle } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatBytes } from '../../core/format'
import { nextStoragePlan, storagePlans } from '../../core/plans'
import { sessionQuery } from '../queries'
import { useWorkspaceSlug } from '../workspace'
import { useI18n } from '../i18n'

// Only the account whose plan governs the workspace can raise the allowance, so everyone else
// gets pointed at a person rather than a dead button.
export function StorageUpgradeAction({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { t: messages, locale } = useI18n()
  const t = messages.storage.upgrade
  const planNames = messages.settings.plan.names
  const workspaceSlug = useWorkspaceSlug()
  const { data } = useSuspenseQuery(sessionQuery(workspaceSlug))
  const billing = data.billing
  if (!billing?.available) return null

  if (!billing.canUpgrade) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{t.askAdmin}</p>
  }

  const upgrade = nextStoragePlan(billing.workspacePlan)
  if (!upgrade) return null

  return (
    <Link
      to="/plan"
      className={cn(buttonVariants({ size: 'sm' }), className)}
      onClick={onNavigate}
      aria-label={t.label(planNames[upgrade], formatBytes(storagePlans[upgrade].quotaBytes, locale))}
    >
      <ArrowUpCircle />
      {t.action(planNames[upgrade])}
    </Link>
  )
}
