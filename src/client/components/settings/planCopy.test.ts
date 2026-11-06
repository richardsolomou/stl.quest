import { describe, expect, it } from 'vitest'
import { messagesFor } from '../../../core/i18n'
import { includedStorageOnboardingCopy, planSummary } from './planCopy'

const en = messagesFor('en')

const periodEnd = new Date('2026-08-28T00:00:00Z')

describe('planSummary', () => {
  it('describes the free allowance when there is no subscription', () => {
    expect(planSummary(undefined, 'free', en, 'en')).toBe('The Free plan includes 1.0 GB of managed storage.')
  })

  it('names the renewal date and price', () => {
    expect(planSummary({ status: 'active', periodEnd }, 'pro', en, 'en')).toBe('Renews 28 August 2026 for $10.')
  })

  it('names when a trial ends and what it becomes', () => {
    expect(planSummary({ status: 'trialing', trialEnd: periodEnd }, 'supporter', en, 'en')).toBe(
      'Trial ends 28 August 2026, then $5 a month.',
    )
  })

  it('says what a pending cancellation costs the account', () => {
    expect(planSummary({ status: 'active', cancelAtPeriodEnd: true, periodEnd }, 'pro', en, 'en')).toBe(
      'Ends 28 August 2026, then your storage drops to 1.0 GB.',
    )
  })

  it('asks for payment details when the last payment failed', () => {
    expect(planSummary({ status: 'past_due' }, 'pro', en, 'en')).toBe(
      'The last payment failed. Update your payment details to keep this plan.',
    )
  })

  it('reports an ended subscription as inactive', () => {
    expect(planSummary({ status: 'canceled' }, 'pro', en, 'en')).toBe('This plan is no longer active.')
  })

  it('stays useful when Stripe gives no dates', () => {
    expect(planSummary({ status: 'active' }, 'supporter', en, 'en')).toBe('Your Supporter plan is active.')
  })
})

describe('includedStorageOnboardingCopy', () => {
  it('identifies the free plan allowance', () => {
    expect(includedStorageOnboardingCopy('free', en, 'en')).toBe(
      'Hosted by STL Quest. Your Free plan includes 1.0 GB total for models, previews, and thumbnails, shared across all your workspaces. Nothing else to configure.',
    )
  })

  it('describes paid storage as the account plan allowance', () => {
    expect(includedStorageOnboardingCopy('supporter', en, 'en')).toBe(
      'Hosted by STL Quest. Your plan includes 25.0 GB total for models, previews, and thumbnails, shared across all your workspaces. Nothing else to configure.',
    )
  })
})
