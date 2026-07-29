import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatBytes } from '../../../core/format'
import { storagePlans, type StoragePlan } from '../../../core/plans'
import { authClient } from '../../authClient'
import { SettingsSection } from './SettingsLayout'

export function AccountBillingSection({ plan }: { plan: StoragePlan }) {
  const [pending, setPending] = useState<StoragePlan | 'portal'>()
  const [error, setError] = useState<string>()
  const paid = plan !== 'free'

  const subscribe = async (nextPlan: Exclude<StoragePlan, 'free'>) => {
    setPending(nextPlan)
    setError(undefined)
    try {
      const returnUrl = `${window.location.origin}/account`
      const result = await authClient.subscription.upgrade({ plan: nextPlan, successUrl: returnUrl, cancelUrl: returnUrl })
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
      const result = await authClient.subscription.billingPortal({ returnUrl: `${window.location.origin}/account` })
      if (result.error) setError(result.error.message ?? 'Could not open the billing portal.')
    } catch {
      setError('Could not open the billing portal.')
    } finally {
      setPending(undefined)
    }
  }

  return (
    <SettingsSection
      title="Plan"
      description={`Your ${storagePlans[plan].name} plan includes ${formatBytes(storagePlans[plan].quotaBytes)} of managed storage.`}
    >
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
      {paid && (
        <Button type="button" variant="outline" disabled={pending !== undefined} onClick={() => void manage()}>
          {pending === 'portal' ? 'Opening Stripe…' : 'Manage billing'}
        </Button>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </SettingsSection>
  )
}
