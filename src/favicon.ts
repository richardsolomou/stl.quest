import { appPath } from './basePath'

export function faviconHref(version: string) {
  return appPath(`/favicon.svg?v=${encodeURIComponent(version)}`)
}
