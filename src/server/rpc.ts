import { getRequest } from '@tanstack/react-start/server'
import { createRpc } from 'ras-stack/server'
import { logger } from './logger'
import { requireMutationOrigin } from './mutationOrigin'

export const { rpc, mutationRpc } = createRpc({
  getRequest,
  requireMutation: requireMutationOrigin,
  logError: (error, context) => logger.error({ err: error, event: 'server_function_failed', ...context }, 'server function failed'),
})
