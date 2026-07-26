import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Identity } from '../core/types'
import { logger } from './logger'

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
  const context = storage.getStore()?.log
  if (!context) return
  const claimedDistinctId = storage.getStore()?.request.headers.get('x-posthog-distinct-id')
  if (claimedDistinctId === identity.id) context.posthogDistinctId = identity.id
  if (identity.workspaceId) context.workspace_id = identity.workspaceId
}

export async function withRequestContext(request: Request, handler: () => Promise<Response>) {
  const requestId = request.headers.get('x-request-id')?.slice(0, 128) || crypto.randomUUID()
  const sessionId = safePostHogId(request.headers.get('x-posthog-session-id'))
  const startedAt = performance.now()
  const path = new URL(request.url).pathname
  return storage.run({ request, log: { request_id: requestId, sessionId } }, async () => {
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
    if (!['/api/health', '/api/events', '/api/board-presence'].includes(path)) {
      const context = {
        event: 'http_request',
        outcome: response.status >= 500 ? 'error' : response.status >= 400 ? 'rejected' : 'success',
        method: request.method,
        path,
        status: response.status,
        duration_ms: Math.round(performance.now() - startedAt),
      }
      if (response.status >= 500)
        logger.error({ ...context, ...(unexpectedError === undefined ? {} : { err: unexpectedError }) }, 'request completed')
      else if (request.method !== 'GET' || context.duration_ms >= 1_000) logger.info(context, 'request completed')
      else logger.debug(context, 'request completed')
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  })
}
function safePostHogId(value: string | null) {
  return value && /^[\w-]{1,128}$/.test(value) ? value : undefined
}
