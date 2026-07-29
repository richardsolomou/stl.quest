import { expect, it, vi } from 'vitest'

import { deletePreviewCustomers } from './previewStripe'

it('deletes only test customers tagged with the pull request', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      data: [
        { id: 'cus_pr_180', livemode: false, metadata: { stlquest_preview_pr: '180' } },
        { id: 'cus_other_pr', livemode: false, metadata: { stlquest_preview_pr: '456' } },
      ],
      has_more: true,
    })
    .mockResolvedValueOnce({
      data: [{ id: 'cus_pr_180_second', livemode: false, metadata: { stlquest_preview_pr: '180' } }],
      has_more: false,
    })
    .mockResolvedValueOnce({ deleted: true })
    .mockResolvedValueOnce({ deleted: true })

  await expect(deletePreviewCustomers('180', request)).resolves.toBe(2)
  expect(request.mock.calls).toEqual([
    ['customers?limit=100'],
    ['customers?limit=100&starting_after=cus_other_pr'],
    ['customers/cus_pr_180', { method: 'DELETE' }],
    ['customers/cus_pr_180_second', { method: 'DELETE' }],
  ])
})

it('refuses to delete a live customer', async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ data: [{ id: 'cus_live', livemode: true, metadata: { stlquest_preview_pr: '180' } }], has_more: false })

  await expect(deletePreviewCustomers('180', request)).rejects.toThrow('refusing to delete live Stripe customer cus_live')
})
