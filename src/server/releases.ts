import { logger } from './logger'

const LATEST_RELEASE_URL = 'https://api.github.com/repos/richardsolomou/stl.quest/releases/latest'
const RELEASE_CACHE_MS = 12 * 60 * 60 * 1000
const RELEASE_RETRY_MS = 15 * 60 * 1000
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

class ReleaseRequestError extends Error {
  constructor(
    readonly status: number,
    readonly retryAt: number | undefined,
  ) {
    super(`GitHub release request failed (${status})`)
  }
}

// GitHub reports rate limits as 403 or 429 with either Retry-After (seconds) or X-RateLimit-Reset (epoch seconds).
function rateLimitRetryAt(headers: Headers, now: number) {
  const retryAfter = Number(headers.get('retry-after'))
  if (headers.has('retry-after') && Number.isFinite(retryAfter) && retryAfter >= 0) return now + retryAfter * 1000
  const reset = Number(headers.get('x-ratelimit-reset'))
  if (headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset) && reset > 0) return reset * 1000
  return undefined
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
  retryMs = RELEASE_RETRY_MS,
}: {
  fetcher?: typeof fetch
  now?: () => number
  cacheMs?: number
  retryMs?: number
} = {}) {
  let expiresAt = 0
  let cachedUpdate: ReleaseUpdate | null = null
  let failures = 0
  let pending: Promise<ReleaseUpdate | null> | undefined

  return async (currentVersion: string) => {
    if (now() < expiresAt) return cachedUpdate
    if (pending) return pending

    pending = (async () => {
      try {
        const response = await fetcher(LATEST_RELEASE_URL, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': `STL-Quest/${currentVersion}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(RELEASE_REQUEST_TIMEOUT_MS),
        })
        if (!response.ok) throw new ReleaseRequestError(response.status, rateLimitRetryAt(response.headers, now()))

        const release = (await response.json()) as GitHubRelease
        if (typeof release.tag_name !== 'string') throw new Error('GitHub release response was invalid')

        const latestVersion = release.tag_name.replace(/^v/, '')
        cachedUpdate = isNewerVersion(latestVersion, currentVersion)
          ? {
              latestVersion,
              releaseUrl: `https://github.com/richardsolomou/stl.quest/releases/tag/${encodeURIComponent(release.tag_name)}`,
            }
          : null
        failures = 0
        expiresAt = now() + cacheMs
      } catch (error) {
        // Keep the last known update so a transient failure does not hide the notice.
        failures += 1
        const backoffAt = now() + retryMs * 2 ** (failures - 1)
        const retryAt = error instanceof ReleaseRequestError ? error.retryAt : undefined
        expiresAt = Math.min(Math.max(backoffAt, retryAt ?? 0), now() + cacheMs)
        logger.warn(
          {
            err: error,
            event: 'release_update_check_failed',
            status: error instanceof ReleaseRequestError ? error.status : undefined,
            failures,
            retryAt: new Date(expiresAt).toISOString(),
          },
          'release update check failed',
        )
      } finally {
        pending = undefined
      }
      return cachedUpdate
    })()

    return pending
  }
}

export const checkForReleaseUpdate = createReleaseChecker()
