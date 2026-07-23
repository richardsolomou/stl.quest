import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { logger } from './logger'

type RequestContext = { requestId: string; request: Request }

const storage = new AsyncLocalStorage<RequestContext>()

export function currentRequestId() {
  return storage.getStore()?.requestId
}

export function currentRequest() {
  return storage.getStore()?.request
}

export async function withRequestContext(request: Request, handler: () => Promise<Response>) {
  const requestId = request.headers.get('x-request-id')?.slice(0, 128) || crypto.randomUUID()
  const startedAt = performance.now()
  const path = new URL(request.url).pathname
  return storage.run({ requestId, request }, async () => {
    let response: Response
    try {
      response = await handler()
    } catch (error) {
      if (error instanceof Response) response = error
      else {
        logger.error({ err: error }, 'request failed')
        response = Response.json({ error: 'internal server error' }, { status: 500 })
      }
    }
    const headers = new Headers(response.headers)
    headers.set('x-request-id', requestId)
    if (!['/api/health', '/api/events', '/api/board-presence'].includes(path)) {
      const context = {
        event: 'http_request',
        method: request.method,
        path,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      }
      if (response.status >= 500) logger.error(context, 'request completed')
      else logger.info(context, 'request completed')
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  })
}
