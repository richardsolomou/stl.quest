import { createCsrfMiddleware, createStart } from '@tanstack/react-start'
import { staleServerFunctionMiddleware } from 'ras-stack/tanstack/middleware'
import { messagesFor } from './core/i18n'

// The middleware takes one fixed string, so it is sent in English and the browser translates it by matching it.
const STALE_SERVER_FUNCTION = messagesFor('en').shell.query.staleServerFunction

const csrfMiddleware = createCsrfMiddleware({ filter: (context) => context.handlerType === 'serverFn' })

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, staleServerFunctionMiddleware(STALE_SERVER_FUNCTION)],
}))
