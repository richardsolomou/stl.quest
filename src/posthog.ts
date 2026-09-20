import { definePostHogCoverage } from 'ras-stack/posthog'

export const postHogCoverage = definePostHogCoverage({
  browser: { analytics: true, errorTracking: true, featureFlags: true, identity: true, logs: true, metrics: true, sessionReplay: true },
  server: { analytics: true, errorTracking: true, logs: true, metrics: true, tracing: true },
  sourceMaps: true,
})
