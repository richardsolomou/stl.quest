import { MutationCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { errorMessage } from '../core/error'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 0 } },
    mutationCache: new MutationCache({
      onError: (error) => toast.error(errorMessage(error, 'Something went wrong. Please try again.')),
    }),
  })
}
