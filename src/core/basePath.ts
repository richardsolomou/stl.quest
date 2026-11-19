const segment = /^[A-Za-z0-9._~-]+$/

/** `BASE_PATH` as `''` for the root or a path such as `/stlquest`; throws for anything that is not a plain URL path. */
export function normalizeBasePath(value: string | undefined) {
  const trimmed = value?.trim().replace(/^\/+|\/+$/g, '') ?? ''
  if (!trimmed) return ''
  const segments = trimmed.split('/')
  if (segments.some((part) => !segment.test(part) || part === '.' || part === '..')) {
    throw new Error(`BASE_PATH must be a URL path such as /stlquest, not ${JSON.stringify(value)}`)
  }
  return `/${segments.join('/')}`
}

/** `pathname` relative to `basePath`, or undefined when it lies outside it. */
export function stripBasePath(basePath: string, pathname: string) {
  if (!basePath) return pathname
  if (pathname === basePath) return '/'
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : undefined
}
