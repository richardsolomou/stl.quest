import { MutationCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export function mutationErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.'
}

export function createQueryClient() {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error) => toast.error(mutationErrorMessage(error)),
    }),
  })
}
