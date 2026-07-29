export function queryStateKind(loading: boolean, error: unknown) {
  if (error) return 'error'
  return loading ? 'loading' : 'error'
}

export function queryErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return 'The request failed. Check your connection and try again.'
}

export async function retryQueries(...queries: Array<() => Promise<unknown>>) {
  await Promise.all(queries.map((retry) => retry()))
}

export async function invalidateQueries(queryClient: QueryClient, ...queryKeys: string[]) {
  await Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey: [queryKey] })))
}
import type { QueryClient } from '@tanstack/react-query'
