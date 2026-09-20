import { createTanStackRpc } from 'ras-stack/tanstack/server'
import { observeRpc } from '../adapters/telemetry'
import { logger } from './logger'
import { requireMutationOrigin } from './mutationOrigin'

export const { rpc, mutationRpc } = createTanStackRpc({
  requireMutation: requireMutationOrigin,
  observe: observeRpc,
  logError: (error, context) => logger.error({ err: error, event: 'server_function_failed', ...context }, 'server function failed'),
})
