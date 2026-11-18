import type { Stripe } from 'stripe'

import { STRIPE_PREVIEW_PR_METADATA_KEY } from '../src/server/billing'

export async function deletePreviewCustomers(prNumber: string, stripe: Pick<Stripe, 'customers'>) {
  const customers: Stripe.Customer[] = []
  for await (const customer of stripe.customers.list({ limit: 100 })) {
    if (customer.metadata[STRIPE_PREVIEW_PR_METADATA_KEY] !== prNumber) continue
    if (customer.livemode) throw new Error(`refusing to delete live Stripe customer ${customer.id}`)
    customers.push(customer)
  }
  for (const customer of customers) await stripe.customers.del(customer.id)
  return customers.length
}
