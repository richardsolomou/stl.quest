export function faviconHref(version: string) {
  return `/favicon.svg?v=${encodeURIComponent(version)}`
}
