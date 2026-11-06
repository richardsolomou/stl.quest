import { getRequest } from '@tanstack/react-start/server'
import { createTanStackRpc } from 'ras-stack/tanstack/server'
import { observeRpc } from '../adapters/telemetry'
import { withRequestLocale } from './locale'
import { logger } from './logger'
import { requireMutationOrigin } from './mutationOrigin'

const base = createTanStackRpc({
  requireMutation: requireMutationOrigin,
  observe: observeRpc,
  logError: (error, context) => logger.error({ err: error, event: 'server_function_failed', ...context }, 'server function failed'),
})

function currentRequest() {
  try {
    return getRequest()
  } catch {
    return undefined
  }
}

export const rpc = <T>(work: () => Promise<T> | T) => withRequestLocale(currentRequest(), () => base.rpc(work))

export const mutationRpc = <T>(work: () => Promise<T> | T, request?: Request) =>
  withRequestLocale(request ?? currentRequest(), () => base.mutationRpc(work, request))
