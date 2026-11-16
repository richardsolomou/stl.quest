import { createStart } from '@tanstack/react-start'
import { csrf, securityHeadersMiddleware, serverFunctionIdentity, staleServerFunctions } from './server/middleware'

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware, csrf, staleServerFunctions],
  functionMiddleware: [serverFunctionIdentity],
}))
