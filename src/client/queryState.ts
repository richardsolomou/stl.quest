import type { QueryClient } from '@tanstack/react-query'
import { errorMessage } from '../core/error'

export function queryStateKind(loading: boolean, error: unknown) {
  if (error) return 'error'
  return loading ? 'loading' : 'error'
}

export function queryErrorMessage(error: unknown) {
  return errorMessage(error, 'The request failed. Check your connection and try again.')
}

export async function retryQueries(...queries: Array<() => Promise<unknown>>) {
  await Promise.all(queries.map((retry) => retry()))
}

export async function invalidateQueries(queryClient: QueryClient, ...queryKeys: string[]) {
  await Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey: [queryKey] })))
}
