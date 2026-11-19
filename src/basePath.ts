import type { LocationRewrite } from '@tanstack/react-router'
import { normalizeBasePath, stripBasePath } from './core/basePath'

/** The `<meta>` name the root route renders the base path into, for the browser to read back. */
export const basePathMetaName = 'stlquest:base-path'

/** The path prefix the application is served under, such as `/stlquest`, or `''` at the root of its origin. */
export function basePath() {
  if (typeof document === 'undefined') return normalizeBasePath(process.env.BASE_PATH)
  return document.querySelector<HTMLMetaElement>(`meta[name="${basePathMetaName}"]`)?.content ?? ''
}

/** A root-relative application path, such as `/api/health`, as the browser must request it. */
export function appPath(path: string) {
  return `${basePath()}${path}`
}

/**
 * A built asset's URL from a `?url` import as the browser must request it. The server build gives a root-relative path and
 * the browser build an absolute URL, so both reduce to the same path and hydrate to the same `<link>`.
 */
export function assetPath(url: string) {
  return URL.canParse(url) ? new URL(url).pathname : appPath(url)
}

/** The router's view of URLs under `prefix`: it matches routes without the prefix and links to them with it. */
export function basePathRewrite(prefix: string): LocationRewrite | undefined {
  if (!prefix) return undefined
  return {
    input: ({ url }) => {
      const pathname = stripBasePath(prefix, url.pathname)
      if (pathname !== undefined) url.pathname = pathname
      return url
    },
    output: ({ url }) => {
      url.pathname = `${prefix}${url.pathname}`
      return url
    },
  }
}
