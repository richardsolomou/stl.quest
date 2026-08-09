import { MutationCache } from '@tanstack/react-query'
import { createStackQueryClient } from 'ras-stack/tanstack/query'
import { toast } from 'sonner'
import { errorMessage } from '../core/error'

export function createQueryClient() {
  return createStackQueryClient({
    defaultOptions: { queries: { staleTime: 0 } },
    mutationCache: new MutationCache({
      onError: (error) => toast.error(errorMessage(error, 'Something went wrong. Please try again.')),
    }),
  })
}
