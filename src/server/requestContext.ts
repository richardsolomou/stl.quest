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
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  })
}
