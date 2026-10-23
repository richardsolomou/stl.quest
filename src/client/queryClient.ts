import { MutationCache } from '@tanstack/react-query'
import { createQueryClient as configuredQueryClient } from 'ras-stack/query'
import { toast } from 'sonner'
import { errorMessage } from '../core/error'

export function createQueryClient() {
  return configuredQueryClient({
    defaultOptions: { queries: { staleTime: 0 } },
    mutationCache: new MutationCache({
      onError: (error) => toast.error(errorMessage(error, 'Something went wrong. Please try again.')),
    }),
  })
}
