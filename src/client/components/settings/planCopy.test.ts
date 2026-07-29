import { describe, expect, it } from 'vitest'
import { planSummary } from './planCopy'

const periodEnd = new Date('2026-08-28T00:00:00Z')

describe('planSummary', () => {
  it('describes the free allowance when there is no subscription', () => {
    expect(planSummary(undefined, 'free')).toBe('The Free plan includes 1.0 GB of managed storage.')
  })

  it('names the renewal date and price', () => {
    expect(planSummary({ status: 'active', periodEnd }, 'pro')).toBe('Renews 28 August 2026 for $10.')
  })

  it('names when a trial ends and what it becomes', () => {
    expect(planSummary({ status: 'trialing', trialEnd: periodEnd }, 'supporter')).toBe('Trial ends 28 August 2026, then $5 a month.')
  })

  it('says what a pending cancellation costs the account', () => {
    expect(planSummary({ status: 'active', cancelAtPeriodEnd: true, periodEnd }, 'pro')).toBe(
      'Ends 28 August 2026, then your storage drops to 1.0 GB.',
    )
  })

  it('asks for payment details when the last payment failed', () => {
    expect(planSummary({ status: 'past_due' }, 'pro')).toBe('The last payment failed. Update your payment details to keep this plan.')
  })

  it('reports an ended subscription as inactive', () => {
    expect(planSummary({ status: 'canceled' }, 'pro')).toBe('This plan is no longer active.')
  })

  it('stays useful when Stripe gives no dates', () => {
    expect(planSummary({ status: 'active' }, 'supporter')).toBe('Your Supporter plan is active.')
  })
})
