import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { unknownServerFunctionResponse } from './server/unknownServerFunction'

const csrfMiddleware = createCsrfMiddleware({ filter: (context) => context.handlerType === 'serverFn' })

const unknownServerFunctionMiddleware = createMiddleware().server(async ({ next, handlerType }) => {
  if (handlerType !== 'serverFn') return next()
  try {
    return await next()
  } catch (error) {
    const response = unknownServerFunctionResponse(error)
    if (response) return response
    throw error
  }
})

export const startInstance = createStart(() => ({ requestMiddleware: [csrfMiddleware, unknownServerFunctionMiddleware] }))
