import { createCsrfMiddleware, createStart } from '@tanstack/react-start'
import { staleServerFunctionMiddleware } from 'ras-stack/tanstack/middleware'

const csrfMiddleware = createCsrfMiddleware({ filter: (context) => context.handlerType === 'serverFn' })

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, staleServerFunctionMiddleware('STL Quest has been updated. Refresh the page to continue.')],
}))
