import { definePostHogCoverage } from 'ras-stack/posthog'

export const postHogCoverage = definePostHogCoverage({
  browser: { analytics: true, errorTracking: true, featureFlags: true, identity: true, sessionReplay: true },
  server: { analytics: true, errorTracking: true, logs: true },
  sourceMaps: { disabled: 'source-map upload requires a deployment personal API key' },
})
