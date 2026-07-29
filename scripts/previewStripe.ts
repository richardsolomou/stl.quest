import { STRIPE_PREVIEW_PR_METADATA_KEY } from '../src/server/billing'

interface StripeCustomer {
  id: string
  livemode: boolean
  metadata: Record<string, string>
}

interface StripeCustomerList {
  data: StripeCustomer[]
  has_more: boolean
}

type StripeRequest = <T>(path: string, options?: { method?: string }) => Promise<T>

export async function deletePreviewCustomers(prNumber: string, request: StripeRequest) {
  let startingAfter: string | undefined
  const customers: StripeCustomer[] = []

  do {
    const params = new URLSearchParams({ limit: '100' })
    if (startingAfter) params.set('starting_after', startingAfter)
    const result = await request<StripeCustomerList>(`customers?${params}`)
    for (const customer of result.data) {
      if (customer.metadata[STRIPE_PREVIEW_PR_METADATA_KEY] !== prNumber) continue
      if (customer.livemode) throw new Error(`refusing to delete live Stripe customer ${customer.id}`)
      customers.push(customer)
    }
    startingAfter = result.has_more ? result.data.at(-1)?.id : undefined
    if (result.has_more && !startingAfter) throw new Error('Stripe returned an empty customer page with more results')
  } while (startingAfter)

  for (const customer of customers) await request(`customers/${customer.id}`, { method: 'DELETE' })
  return customers.length
}
