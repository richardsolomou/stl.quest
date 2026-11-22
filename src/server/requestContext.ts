import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Identity } from '../core/types'
import { withRequestLocale } from './locale'
import { logger } from './logger'
import { requestContext as postHogRequestContext } from './telemetry'
import { appPath } from '../basePath'

type LogContext = {
  request_id: string
  sessionId?: string
  posthogDistinctId?: string
  workspace_id?: string
}

type RequestContext = { request: Request; log: LogContext }

const storage = new AsyncLocalStorage<RequestContext>()

export function currentRequestId() {
  return storage.getStore()?.log.request_id
}

export function currentRequest() {
  return storage.getStore()?.request
}

export function currentRequestLogContext() {
  return storage.getStore()?.log
}

export function setRequestIdentity(identity: Identity) {
  const store = storage.getStore()
  if (!store) return
  const { distinctId } = postHogRequestContext(store.request, identity.id)
  if (distinctId) store.log.posthogDistinctId = distinctId
  if (identity.workspaceId) store.log.workspace_id = identity.workspaceId
}

/** `loggedPath` replaces the request's path in logs when the path itself carries a credential, such as a signed link. */
export async function withRequestContext(request: Request, handler: () => Promise<Response>, loggedPath?: string) {
  const requestId = request.headers.get('x-request-id')?.slice(0, 128) || crypto.randomUUID()
  const { sessionId } = postHogRequestContext(request)
  const startedAt = performance.now()
  const path = new URL(request.url).pathname
  return withRequestLocale(request, () =>
    storage.run({ request, log: { request_id: requestId, sessionId } }, async () => {
      let response: Response
      let unexpectedError: unknown
      try {
        response = await handler()
      } catch (error) {
        if (error instanceof Response) response = error
        else {
          unexpectedError = error
          response = Response.json({ error: 'internal server error' }, { status: 500 })
        }
      }
      const headers = new Headers(response.headers)
      headers.set('x-request-id', requestId)
      if (path !== appPath('/api/health')) {
        const context = {
          event: 'http_request',
          outcome: response.status >= 500 ? 'error' : response.status >= 400 ? 'rejected' : 'success',
          method: request.method,
          path: loggedPath ?? path,
          status: response.status,
          duration_ms: Math.round(performance.now() - startedAt),
        }
        if (response.status >= 500)
          logger.error({ ...context, ...(unexpectedError === undefined ? {} : { err: unexpectedError }) }, 'request completed')
        else if (request.method !== 'GET' || context.duration_ms >= 1_000) logger.info(context, 'request completed')
        else logger.debug(context, 'request completed')
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    }),
  )
}
