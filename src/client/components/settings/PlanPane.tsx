import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatBytes } from '../../../core/format'
import { storagePlans, type StoragePlan } from '../../../core/plans'
import { authClient } from '../../authClient'
import { planOverviewQuery } from '../../queries'
import { planSummary } from './planCopy'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { useI18n } from '../../i18n'

export function PlanPane() {
  const { data } = useSuspenseQuery(planOverviewQuery())
  const [pending, setPending] = useState<StoragePlan | 'portal'>()
  const [error, setError] = useState<string>()
  const { t, locale } = useI18n()
  const copy = t.settings.plan
  const plan = data.plan
  const paid = plan !== 'free'
  // Stripe returns the customer here rather than to the account page.
  const returnUrl = () => `${window.location.origin}/plan`

  const subscribe = async (nextPlan: Exclude<StoragePlan, 'free'>) => {
    setPending(nextPlan)
    setError(undefined)
    try {
      const result = await authClient.subscription.upgrade({ plan: nextPlan, successUrl: returnUrl(), cancelUrl: returnUrl() })
      if (result.error) setError(result.error.message ?? copy.checkoutError)
    } catch {
      setError(copy.checkoutError)
    } finally {
      setPending(undefined)
    }
  }

  const manage = async () => {
    setPending('portal')
    setError(undefined)
    try {
      const result = await authClient.subscription.billingPortal({ returnUrl: returnUrl() })
      if (result.error) setError(result.error.message ?? copy.portalError)
    } catch {
      setError(copy.portalError)
    } finally {
      setPending(undefined)
    }
  }

  if (!data.available) {
    return (
      <SettingsPage>
        <SettingsHeader title={copy.title} description={copy.unavailable} />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage>
      <SettingsHeader title={copy.title} description={copy.description} />
      <SettingsSection title={copy.names[plan]} description={planSummary(data.subscription, plan, t, locale)}>
        <AllowanceBreakdown quotaBytes={data.quotaBytes} workspaces={data.workspaces} />
        {paid && <p className="text-sm text-muted-foreground">{copy.downgradeNote}</p>}
        {paid && (
          <Button type="button" variant="outline" className="self-start" disabled={pending !== undefined} onClick={() => void manage()}>
            {pending === 'portal' ? copy.openingStripe : copy.manageBilling}
          </Button>
        )}
      </SettingsSection>
      <SettingsSection title={copy.change.title} description={copy.change.description}>
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(storagePlans) as StoragePlan[]).map((candidate) => {
            const details = storagePlans[candidate]
            const name = copy.names[candidate]
            const current = candidate === plan
            const upgrade = details.monthlyPrice > storagePlans[plan].monthlyPrice
            return (
              <div key={candidate} className={cn('flex flex-col gap-4 rounded-lg border p-4', current && 'border-primary/50 bg-primary/5')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-heading text-xs font-semibold tracking-[0.08em] uppercase">{name}</span>
                  {current && <span className="text-xs font-medium text-primary">{copy.change.current}</span>}
                </div>
                <div>
                  <p className="font-heading text-2xl leading-none">{formatBytes(details.quotaBytes, locale)}</p>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {details.monthlyPrice ? copy.change.monthly(details.monthlyPrice) : copy.change.noCharge}
                  </p>
                </div>
                {candidate !== 'free' && upgrade && (
                  <Button
                    type="button"
                    size="sm"
                    className="mt-auto"
                    disabled={pending !== undefined}
                    onClick={() => void subscribe(candidate)}
                  >
                    {pending === candidate ? copy.openingStripe : paid ? copy.change.switchTo(name) : copy.change.choose(name)}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </SettingsSection>
    </SettingsPage>
  )
}

/**
 * A shared allowance is an allocation, not a single measurement, so it reads as one bar divided by
 * the workspaces drawing on it with a matching key underneath. Three colours is enough: an account
 * can own at most three workspaces.
 */
const segmentColours = ['bg-primary', 'bg-blueprint', 'bg-secondary-foreground']

function AllowanceBreakdown({
  quotaBytes,
  workspaces,
}: {
  quotaBytes: number
  workspaces: { workspaceId: string; name: string; usedBytes: number }[]
}) {
  const ordered = workspaces.slice().sort((a, b) => b.usedBytes - a.usedBytes)
  const usedBytes = ordered.reduce((total, workspace) => total + workspace.usedBytes, 0)
  const share = (bytes: number) => (quotaBytes > 0 ? Math.min(100, (bytes / quotaBytes) * 100) : 0)
  const colour = (index: number) => segmentColours[index % segmentColours.length]
  const { t, locale } = useI18n()
  const copy = t.settings.plan.allowance

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-heading text-2xl leading-none">{formatBytes(usedBytes, locale)}</p>
        <p className="text-sm text-muted-foreground">{copy.ofUsed(formatBytes(quotaBytes, locale))}</p>
      </div>
      {/* The summary above and the key below state every figure, so the bar is decoration to a reader. */}
      <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {ordered.map((workspace, index) => (
          <span
            key={workspace.workspaceId}
            className={cn('h-full', colour(index), workspace.usedBytes > 0 && 'min-w-[3px]')}
            style={{ width: `${share(workspace.usedBytes)}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {ordered.map((workspace, index) => (
          <li key={workspace.workspaceId} className="flex items-center gap-2.5">
            <span className={cn('size-2 shrink-0 rounded-full', colour(index))} aria-hidden="true" />
            <span className="ph-no-capture min-w-0 flex-1 truncate">{workspace.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(workspace.usedBytes, locale)}</span>
          </li>
        ))}
        <li className="flex items-center gap-2.5 border-t border-dashed border-border pt-1.5">
          <span className="size-2 shrink-0 rounded-full bg-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-muted-foreground">{copy.available}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(Math.max(0, quotaBytes - usedBytes), locale)}</span>
        </li>
      </ul>
    </div>
  )
}
