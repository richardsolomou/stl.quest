import { logger } from './logger'

const LATEST_RELEASE_URL = 'https://api.github.com/repos/richardsolomou/printhub/releases/latest'
const RELEASE_CACHE_MS = 12 * 60 * 60 * 1000
const RELEASE_REQUEST_TIMEOUT_MS = 5_000

type GitHubRelease = {
  tag_name?: unknown
}

export type ReleaseUpdate = {
  latestVersion: string
  releaseUrl: string
}

function versionParts(version: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return match ? match.slice(1).map(Number) : undefined
}

export function isNewerVersion(candidate: string, current: string) {
  const candidateParts = versionParts(candidate)
  const currentParts = versionParts(current)
  if (!candidateParts || !currentParts) return false
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) return candidateParts[index] > currentParts[index]
  }
  return false
}

export function createReleaseChecker({
  fetcher = fetch,
  now = Date.now,
  cacheMs = RELEASE_CACHE_MS,
}: {
  fetcher?: typeof fetch
  now?: () => number
  cacheMs?: number
} = {}) {
  let expiresAt = 0
  let cachedUpdate: ReleaseUpdate | null = null
  let pending: Promise<ReleaseUpdate | null> | undefined

  return async (currentVersion: string) => {
    if (now() < expiresAt) return cachedUpdate
    if (pending) return pending

    pending = (async () => {
      try {
        const response = await fetcher(LATEST_RELEASE_URL, {
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(RELEASE_REQUEST_TIMEOUT_MS),
        })
        if (!response.ok) throw new Error(`GitHub release request failed (${response.status})`)

        const release = (await response.json()) as GitHubRelease
        if (typeof release.tag_name !== 'string') throw new Error('GitHub release response was invalid')

        const latestVersion = release.tag_name.replace(/^v/, '')
        cachedUpdate = isNewerVersion(latestVersion, currentVersion)
          ? {
              latestVersion,
              releaseUrl: `https://github.com/richardsolomou/printhub/releases/tag/${encodeURIComponent(release.tag_name)}`,
            }
          : null
      } catch (error) {
        cachedUpdate = null
        logger.warn({ err: error }, 'release update check failed')
      } finally {
        expiresAt = now() + cacheMs
        pending = undefined
      }
      return cachedUpdate
    })()

    return pending
  }
}

export const checkForReleaseUpdate = createReleaseChecker()
