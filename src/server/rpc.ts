import { getRequest } from '@tanstack/react-start/server'
import { observeRpc } from './optionalTelemetry'
import { withRequestLocale } from './locale'
import { logger } from './logger'
import { requireSameOrigin } from './origins'
import { currentServerFunction } from './serverFunction'

/** Where a failure happened: the request, the server function it ran, and the status of a thrown `Response`. */
export type RpcErrorContext = { method?: string; path?: string; function?: string; status?: number }

/** Runs a server function's work, turning a thrown `Response` into an error whose message reaches the client. */
export function rpc<T>(work: () => Promise<T> | T): Promise<T> {
  const request = currentRequest()
  return withRequestLocale(request, () => run(work, request))
}

/** `rpc` for work that changes state: it answers 403 unless a browser on one of this application's origins sent the request. */
export function mutationRpc<T>(work: () => Promise<T> | T, request = currentRequest()): Promise<T> {
  return withRequestLocale(request, () =>
    run(() => {
      if (!request) throw new Error('mutation request is unavailable')
      requireSameOrigin(request)
      return work()
    }, request),
  )
}

async function run<T>(work: () => Promise<T> | T, request: Request | undefined): Promise<T> {
  return observeRpc(request, async () => {
    try {
      return await work()
    } catch (thrown) {
      const status = thrown instanceof Response ? thrown.status : undefined
      const error =
        thrown instanceof Response ? new Error((await thrown.text()) || `request failed (${thrown.status})`, { cause: thrown }) : thrown
      // A 4xx answer is the caller's to fix; a 5xx one, such as an unreachable upstream, is the server's.
      if (status === undefined || status >= 500) reportFailure(error, failureContext(request, status))
      throw error
    }
  })
}

function reportFailure(error: unknown, context: RpcErrorContext) {
  logger.error({ err: error, event: 'server_function_failed', ...context }, 'server function failed')
}

function failureContext(request: Request | undefined, status: number | undefined): RpcErrorContext {
  const name = currentServerFunction()?.name
  return {
    ...(request ? { method: request.method, path: new URL(request.url).pathname } : {}),
    ...(name ? { function: name } : {}),
    ...(status === undefined ? {} : { status }),
  }
}

function currentRequest() {
  try {
    return getRequest()
  } catch {
    return undefined
  }
}
