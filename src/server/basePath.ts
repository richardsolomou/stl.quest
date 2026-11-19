import type { NitroAppPlugin } from 'nitro/types'
import { normalizeBasePath, stripBasePath } from '../core/basePath'

/** `request` at `pathname` instead, keeping its query, headers, and body. */
export function withPathname(request: Request, pathname: string) {
  const url = new URL(request.url)
  if (url.pathname === pathname) return request
  url.pathname = pathname
  // srvx's Node request reads its URL from `_url`, including when it builds a native copy, and keeps its socket and client IP.
  if ('_url' in request) {
    ;(request as Request & { _url: URL })._url = url
    return request
  }
  return new Request(url, request)
}

/**
 * Serves the application under `BASE_PATH`: each request loses the prefix before Nitro serves static files or Start
 * handles it, so a proxy may forward paths with or without it. `src/server.ts` gives the router the public path back.
 */
const basePath: NitroAppPlugin = (nitro) => {
  const prefix = normalizeBasePath(process.env.BASE_PATH)
  if (!prefix) return
  const handle = nitro.fetch
  nitro.fetch = (request) => {
    const pathname = stripBasePath(prefix, new URL(request.url).pathname)
    return handle(pathname === undefined ? request : withPathname(request, pathname))
  }
}

export default basePath
