import { createStart } from '@tanstack/react-start'
import { appPath } from './basePath'
import { csrf, securityHeadersMiddleware, serverFunctionIdentity, staleServerFunctions } from './server/middleware'

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware, csrf, staleServerFunctions],
  functionMiddleware: [serverFunctionIdentity],
  // Start's server function URLs are root-relative build constants.
  serverFns: { fetch: (url, init) => fetch(typeof url === 'string' ? appPath(url) : url, init) },
}))
