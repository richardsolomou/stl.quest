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

export function PlanPane() {
  const { data } = useSuspenseQuery(planOverviewQuery())
  const [pending, setPending] = useState<StoragePlan | 'portal'>()
  const [error, setError] = useState<string>()
  const plan = data.plan
  const paid = plan !== 'free'
  // Stripe returns the customer here rather than to the account page.
  const returnUrl = () => `${window.location.origin}/plan`

  const subscribe = async (nextPlan: Exclude<StoragePlan, 'free'>) => {
    setPending(nextPlan)
    setError(undefined)
    try {
      const result = await authClient.subscription.upgrade({ plan: nextPlan, successUrl: returnUrl(), cancelUrl: returnUrl() })
      if (result.error) setError(result.error.message ?? 'Could not open Stripe Checkout.')
    } catch {
      setError('Could not open Stripe Checkout.')
    } finally {
      setPending(undefined)
    }
  }

  const manage = async () => {
    setPending('portal')
    setError(undefined)
    try {
      const result = await authClient.subscription.billingPortal({ returnUrl: returnUrl() })
      if (result.error) setError(result.error.message ?? 'Could not open the billing portal.')
    } catch {
      setError('Could not open the billing portal.')
    } finally {
      setPending(undefined)
    }
  }

  if (!data.available) {
    return (
      <SettingsPage>
        <SettingsHeader title="Plan" description="Billing is not enabled on this deployment." />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage>
      <SettingsHeader title="Plan" description="See what your plan covers and change it." />
      <SettingsSection title={storagePlans[plan].name} description={planSummary(data.subscription, plan)}>
        <AllowanceBreakdown quotaBytes={data.quotaBytes} workspaces={data.workspaces} />
        {paid && (
          <p className="text-sm text-muted-foreground">
            Moving to a smaller plan keeps your models: you can still open, download, delete, and move them. Only new uploads stop until
            usage is back inside the allowance.
          </p>
        )}
        {paid && (
          <Button type="button" variant="outline" className="self-start" disabled={pending !== undefined} onClick={() => void manage()}>
            {pending === 'portal' ? 'Opening Stripe…' : 'Manage billing'}
          </Button>
        )}
      </SettingsSection>
      <SettingsSection title="Change plan" description="Storage is shared across every workspace you own that uses included storage.">
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(storagePlans) as StoragePlan[]).map((candidate) => {
            const details = storagePlans[candidate]
            const current = candidate === plan
            const upgrade = details.monthlyPrice > storagePlans[plan].monthlyPrice
            return (
              <div key={candidate} className={cn('flex flex-col gap-4 rounded-lg border p-4', current && 'border-primary/50 bg-primary/5')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-heading text-xs font-semibold tracking-[0.08em] uppercase">{details.name}</span>
                  {current && <span className="text-xs font-medium text-primary">Current</span>}
                </div>
                <div>
                  <p className="font-heading text-2xl leading-none">{formatBytes(details.quotaBytes)}</p>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {details.monthlyPrice ? `$${details.monthlyPrice} a month` : 'No charge'}
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
                    {pending === candidate ? 'Opening Stripe…' : paid ? `Switch to ${details.name}` : `Choose ${details.name}`}
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-heading text-2xl leading-none">{formatBytes(usedBytes)}</p>
        <p className="text-sm text-muted-foreground">of {formatBytes(quotaBytes)} used</p>
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
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(workspace.usedBytes)}</span>
          </li>
        ))}
        <li className="flex items-center gap-2.5 border-t border-dashed border-border pt-1.5">
          <span className="size-2 shrink-0 rounded-full bg-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-muted-foreground">Available</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(Math.max(0, quotaBytes - usedBytes))}</span>
        </li>
      </ul>
    </div>
  )
}
