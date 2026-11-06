import type { QueryClient } from '@tanstack/react-query'
import { errorMessage } from '../core/error'
import type { Messages } from '../core/i18n'

export function queryStateKind(loading: boolean, error: unknown) {
  if (error) return 'error'
  return loading ? 'loading' : 'error'
}

export function queryErrorMessage(error: unknown, t: Messages) {
  return errorMessage(error, t.shell.query.requestFailed)
}

export async function retryQueries(...queries: Array<() => Promise<unknown>>) {
  await Promise.all(queries.map((retry) => retry()))
}

export async function invalidateQueries(queryClient: QueryClient, ...queryKeys: string[]) {
  await Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey: [queryKey] })))
}
