import type { Stripe } from 'stripe'
import { expect, it, vi } from 'vitest'

import { deletePreviewCustomers } from './previewStripe'

function stripeWith(customers: Partial<Stripe.Customer>[]) {
  const del = vi.fn().mockResolvedValue({ deleted: true })
  const list = vi.fn(async function* () {
    yield* customers
  })
  return { del, stripe: { customers: { list, del } } as unknown as Pick<Stripe, 'customers'> }
}

it('deletes only test customers tagged with the pull request', async () => {
  const { stripe, del } = stripeWith([
    { id: 'cus_pr_180', livemode: false, metadata: { stlquest_preview_pr: '180' } },
    { id: 'cus_other_pr', livemode: false, metadata: { stlquest_preview_pr: '456' } },
    { id: 'cus_pr_180_second', livemode: false, metadata: { stlquest_preview_pr: '180' } },
  ])

  await expect(deletePreviewCustomers('180', stripe)).resolves.toBe(2)
  expect(del.mock.calls).toEqual([['cus_pr_180'], ['cus_pr_180_second']])
})

it('refuses to delete a live customer', async () => {
  const { stripe, del } = stripeWith([{ id: 'cus_live', livemode: true, metadata: { stlquest_preview_pr: '180' } }])

  await expect(deletePreviewCustomers('180', stripe)).rejects.toThrow('refusing to delete live Stripe customer cus_live')
  expect(del).not.toHaveBeenCalled()
})
