import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
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
              <div key={candidate} className="flex flex-col gap-3 rounded-lg border p-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium">{details.name}</h3>
                    {current && <span className="text-xs font-medium text-muted-foreground">Current</span>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{formatBytes(details.quotaBytes)} managed storage</p>
                  <p className="mt-2 text-lg font-semibold">{details.monthlyPrice ? `$${details.monthlyPrice}/month` : 'Free'}</p>
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

// One allowance covers every workspace entitled to the account, so the split is the part that
// explains a nearly-full plan.
function AllowanceBreakdown({
  quotaBytes,
  workspaces,
}: {
  quotaBytes: number
  workspaces: { workspaceId: string; name: string; usedBytes: number }[]
}) {
  const usedBytes = workspaces.reduce((total, workspace) => total + workspace.usedBytes, 0)
  return (
    <div className="flex flex-col gap-2">
      <Progress value={quotaBytes ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0} aria-label="Included storage usage" />
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} used
        </span>
        <span>{formatBytes(Math.max(0, quotaBytes - usedBytes))} available</span>
      </div>
      {workspaces.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1 text-sm">
          {workspaces
            .slice()
            .sort((a, b) => b.usedBytes - a.usedBytes)
            .map((workspace) => (
              <li key={workspace.workspaceId} className="flex justify-between gap-3">
                <span className="ph-no-capture truncate">{workspace.name}</span>
                <span className="shrink-0 text-muted-foreground">{formatBytes(workspace.usedBytes)}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
