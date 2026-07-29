import { afterEach, describe, expect, it, vi } from 'vitest'
import { billingAvailable, stripeBillingPlugin } from './billing'

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
})
