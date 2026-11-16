/** Names this application's PostHog logs, metrics, and spans; the browser reports as `<name>-web` and the server as `<name>-server`. */
export const serviceName = 'stlquest'

/** Where the browser sends PostHog requests on this origin. Ad-blocker lists match the literal `/ingest` segment on any host. */
export const ingestPath = '/t'

/** The build variables holding the project token and host; the browser bundle and the server read the same names. */
export const projectTokenVariable = 'VITE_POSTHOG_PROJECT_TOKEN'
export const hostVariable = 'VITE_POSTHOG_HOST'

/** The ingestion host when `hostVariable` is unset: US Cloud, or `https://eu.i.posthog.com` for EU Cloud. */
export const defaultHost = 'https://us.i.posthog.com'

export type PostHogEnvironment = { projectToken: string; host: string; uiHost: string; assetsHost: string }

/**
 * PostHog's project and hosts; undefined with neither set, which keeps PostHog off. A host
 * without a token throws, since it means analytics were meant to be on and a missing token would turn them off silently.
 */
export function postHogEnvironment(input: {
  projectToken?: string | undefined
  host?: string | undefined
}): PostHogEnvironment | undefined {
  const projectToken = input.projectToken?.trim()
  const configuredHost = input.host?.trim()
  if (!projectToken) {
    if (configuredHost) throw new Error(`${projectTokenVariable} is required when ${hostVariable} is set`)
    return undefined
  }
  const host = httpUrl(configuredHost || defaultHost)
  return { projectToken, host: host.toString().replace(/\/$/, ''), uiHost: uiHost(host), assetsHost: assetsHost(host) }
}

/** The project this build's browser bundle reports to, fixed when Vite builds it; the ingest proxy forwards to the same hosts. */
export const bundledPostHog = postHogEnvironment({
  projectToken: import.meta.env[projectTokenVariable],
  host: import.meta.env[hostVariable],
})

function httpUrl(value: string) {
  const url = URL.parse(value)
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${hostVariable} must be an HTTP URL without credentials, query, or fragment`)
  }
  return url
}

function uiHost(host: URL) {
  if (host.hostname === 'us.i.posthog.com') return 'https://us.posthog.com'
  if (host.hostname === 'eu.i.posthog.com') return 'https://eu.posthog.com'
  return host.origin
}

function assetsHost(host: URL) {
  if (host.hostname === 'us.i.posthog.com') return 'https://us-assets.i.posthog.com'
  if (host.hostname === 'eu.i.posthog.com') return 'https://eu-assets.i.posthog.com'
  return host.toString().replace(/\/$/, '')
}
