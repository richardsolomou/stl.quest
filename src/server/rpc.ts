import { getRequest } from '@tanstack/react-start/server'
import { logger } from './logger'

export async function rpc<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof Response) throw new Error((await error.text()) || `request failed (${error.status})`, { cause: error })
    logger.error({ err: error, event: 'server_function_failed', ...requestContext() }, 'server function failed')
    throw error
  }
}

function requestContext() {
  try {
    const request = getRequest()
    return { method: request.method, path: new URL(request.url).pathname }
  } catch {
    return {}
  }
}
