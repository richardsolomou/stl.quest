import { afterEach, describe, expect, it, vi } from 'vitest'
import { billingAvailable, managedPaymentsCheckoutParams, stripeBillingPlugin, stripePlanDefinitions } from './billing'

afterEach(() => vi.unstubAllEnvs())

describe('hosted billing', () => {
  it('stays disabled outside hosted deployments', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret')
    expect(billingAvailable()).toBe(false)
  })

  it('rejects partial Stripe configuration', () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret')
    expect(() => billingAvailable()).toThrow('Stripe billing requires')
  })

  it('enables the Better Auth plugin when every required value is configured', () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_secret')
    vi.stubEnv('STRIPE_SUPPORTER_PRICE_ID', 'price_supporter')
    vi.stubEnv('STRIPE_PRO_PRICE_ID', 'price_pro')

    expect(billingAvailable()).toBe(true)
    expect(stripeBillingPlugin()?.id).toBe('stripe')
  })

  it('maps Stripe prices to the storage plan catalog', () => {
    expect(stripePlanDefinitions({ supporterPriceId: 'price_supporter', proPriceId: 'price_pro' })).toEqual([
      { name: 'supporter', priceId: 'price_supporter', limits: { storageBytes: 25_000_000_000 } },
      { name: 'pro', priceId: 'price_pro', limits: { storageBytes: 100_000_000_000 } },
    ])
  })

  it('enables Managed Payments for every Checkout session', () => {
    expect(managedPaymentsCheckoutParams()).toEqual({ params: { managed_payments: { enabled: true } } })
  })
})
