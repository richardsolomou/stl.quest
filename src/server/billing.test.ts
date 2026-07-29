import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  billingAvailable,
  checkoutSessionParams,
  STRIPE_PREVIEW_PR_METADATA_KEY,
  stripeBillingPlugin,
  stripePlanDefinitions,
} from './billing'

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
    const plugin = stripeBillingPlugin()
    expect(plugin?.id).toBe('stripe')
    expect((plugin?.options as { createCustomerOnSignUp?: boolean } | undefined)?.createCustomerOnSignUp).toBe(false)
  })

  it('tags customers created by a pull request preview', async () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_secret')
    vi.stubEnv('STRIPE_SUPPORTER_PRICE_ID', 'price_supporter')
    vi.stubEnv('STRIPE_PRO_PRICE_ID', 'price_pro')
    vi.stubEnv('STRIPE_PREVIEW_PR_NUMBER', '180')

    const options = stripeBillingPlugin()?.options as {
      createCustomerOnSignUp?: boolean
      getCustomerCreateParams?: () => Promise<{ metadata: Record<string, string> }>
    }
    expect(options.createCustomerOnSignUp).toBe(true)
    expect(await options.getCustomerCreateParams?.()).toEqual({ metadata: { [STRIPE_PREVIEW_PR_METADATA_KEY]: '180' } })
  })

  it('maps Stripe prices to the storage plan catalog', () => {
    expect(stripePlanDefinitions({ supporterPriceId: 'price_supporter', proPriceId: 'price_pro' })).toEqual([
      { name: 'supporter', priceId: 'price_supporter', limits: { storageBytes: 25_000_000_000 } },
      { name: 'pro', priceId: 'price_pro', limits: { storageBytes: 100_000_000_000 } },
    ])
  })

  it('enables Managed Payments for every Checkout session', () => {
    expect(checkoutSessionParams().params.managed_payments).toEqual({ enabled: true })
  })

  it('offers a promotion code field on every Checkout session', () => {
    expect(checkoutSessionParams().params.allow_promotion_codes).toBe(true)
  })

  it('does not collect a payment method when a promotion makes Checkout free', () => {
    expect(checkoutSessionParams().params.payment_method_collection).toBe('if_required')
  })
})
