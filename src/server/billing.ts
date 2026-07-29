import { stripe } from '@better-auth/stripe'
import Stripe from 'stripe'
import { storagePlans } from '../core/plans'
import { hostedDeployment } from './hosted'

const billingKeys = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_SUPPORTER_PRICE_ID', 'STRIPE_PRO_PRICE_ID'] as const

type BillingConfig = {
  secretKey: string
  webhookSecret: string
  supporterPriceId: string
  proPriceId: string
}

export function stripePlanDefinitions(config: Pick<BillingConfig, 'supporterPriceId' | 'proPriceId'>) {
  return [
    {
      name: 'supporter',
      priceId: config.supporterPriceId,
      limits: { storageBytes: storagePlans.supporter.quotaBytes },
    },
    {
      name: 'pro',
      priceId: config.proPriceId,
      limits: { storageBytes: storagePlans.pro.quotaBytes },
    },
  ]
}

export function checkoutSessionParams() {
  return {
    params: {
      managed_payments: { enabled: true as const },
      allow_promotion_codes: true,
      payment_method_collection: 'if_required' as const,
    },
  }
}

export function billingAvailable() {
  return resolveBillingConfig() !== undefined
}

export function stripeBillingPlugin() {
  const config = resolveBillingConfig()
  if (!config) return undefined
  return stripe({
    stripeClient: new Stripe(config.secretKey),
    stripeWebhookSecret: config.webhookSecret,
    createCustomerOnSignUp: false,
    subscription: {
      enabled: true,
      plans: stripePlanDefinitions(config),
      getCheckoutSessionParams: checkoutSessionParams,
    },
  })
}

function resolveBillingConfig() {
  if (!hostedDeployment()) return undefined
  const values = billingKeys.map((key) => process.env[key]?.trim())
  const configured = values.filter(Boolean).length
  if (!configured) return undefined
  if (configured !== billingKeys.length) throw new Error(`Stripe billing requires ${billingKeys.join(', ')}`)
  const [secretKey, webhookSecret, supporterPriceId, proPriceId] = values as [string, string, string, string]
  return { secretKey, webhookSecret, supporterPriceId, proPriceId } satisfies BillingConfig
}
