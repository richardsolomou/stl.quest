import { definePostHogCoverage } from 'ras-stack/posthog'

// Some ad-blocker lists (EasyList/EasyPrivacy) block the literal `/ingest`
// path segment regardless of host, so the ingest proxy uses a path they don't match.
export const POSTHOG_INGEST_PATH = '/t'

export const postHogCoverage = definePostHogCoverage({
  browser: { analytics: true, errorTracking: true, featureFlags: true, identity: true, sessionReplay: true },
  server: { analytics: true, errorTracking: true, logs: true },
  sourceMaps: { disabled: 'source-map upload requires a deployment personal API key' },
})
