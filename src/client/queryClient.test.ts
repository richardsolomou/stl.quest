import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { createQueryClient } from './queryClient'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

describe('mutation errors', () => {
  it('shows a failure without a component error handler', async () => {
    const queryClient = createQueryClient()
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async () => {
        throw new Error('move failed')
      },
    })

    await expect(mutation.execute(undefined)).rejects.toThrow('move failed')
    expect(toast.error).toHaveBeenCalledWith('move failed')
  })

  it('shows a useful message for an unknown failure', async () => {
    const queryClient = createQueryClient()
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async () => Promise.reject(null),
    })

    await expect(mutation.execute(undefined)).rejects.toBeNull()
    expect(toast.error).toHaveBeenCalledWith('Something went wrong. Please try again.')
  })
})
