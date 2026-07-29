import { describe, expect, it } from 'vitest'
import { subscriptionState } from './subscription'

const periodEnd = new Date('2026-08-28T00:00:00Z')
const trialEnd = new Date('2026-08-05T00:00:00Z')

describe('subscriptionState', () => {
  it('reports no subscription when there is nothing to report', () => {
    expect(subscriptionState(undefined)).toEqual({ kind: 'none' })
  })

  it('reports when an active subscription renews', () => {
    expect(subscriptionState({ status: 'active', periodEnd })).toEqual({ kind: 'active', renewsAt: periodEnd })
  })

  it('reports when a trial ends', () => {
    expect(subscriptionState({ status: 'trialing', trialEnd, periodEnd })).toEqual({ kind: 'trialing', trialEndsAt: trialEnd })
  })

  it('reports a pending cancellation rather than the renewal it replaces', () => {
    expect(subscriptionState({ status: 'active', cancelAtPeriodEnd: true, periodEnd })).toEqual({ kind: 'ending', endsAt: periodEnd })
  })

  it('prefers the explicit cancellation date when Stripe supplies one', () => {
    const cancelAt = new Date('2026-08-20T00:00:00Z')
    expect(subscriptionState({ status: 'active', cancelAtPeriodEnd: true, cancelAt, periodEnd })).toEqual({
      kind: 'ending',
      endsAt: cancelAt,
    })
  })

  it('reports a cancelling trial by when the trial ends', () => {
    expect(subscriptionState({ status: 'trialing', cancelAtPeriodEnd: true, trialEnd })).toEqual({ kind: 'ending', endsAt: trialEnd })
  })

  it.each(['past_due', 'unpaid'])('reports %s as needing payment', (status) => {
    expect(subscriptionState({ status, periodEnd })).toEqual({ kind: 'pastDue' })
  })

  it.each(['canceled', 'incomplete_expired'])('reports %s as inactive', (status) => {
    expect(subscriptionState({ status })).toEqual({ kind: 'inactive' })
  })
})
