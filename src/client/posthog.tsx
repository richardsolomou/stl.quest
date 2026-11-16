import { PostHogErrorBoundary, PostHogProvider } from '@posthog/react'
import { posthog } from 'posthog-js'
import type { ReactNode } from 'react'
import { bundledPostHog } from '../contracts/posthog'
import { postHogOptions } from './posthogOptions'

// Initialized while the first enabled integration renders, before any child's effect can capture. The deployment's telemetry
// setting decides whether PostHog starts at all, so it cannot start when this module loads.
function startPostHog() {
  if (bundledPostHog && typeof window !== 'undefined' && !posthog.__loaded) {
    posthog.init(bundledPostHog.projectToken, postHogOptions(bundledPostHog, window.location.hostname))
  }
}

/**
 * Gives components `usePostHog()` and the feature flag hooks, and captures render errors from routes without their own
 * `errorComponent`. Renders its children alone when PostHog is off or the deployment turned telemetry off.
 */
export function PostHogIntegration({ enabled, fallback, children }: { enabled: boolean; fallback: ReactNode; children: ReactNode }) {
  if (!bundledPostHog || !enabled) return children
  startPostHog()
  return (
    <PostHogProvider client={posthog}>
      <PostHogErrorBoundary fallback={fallback}>{children}</PostHogErrorBoundary>
    </PostHogProvider>
  )
}

/** The router's `defaultOnCatch`, for routes with an `errorComponent`, whose boundary catches the error before `PostHogIntegration`'s. */
export function captureRenderError(error: unknown) {
  if (posthog.__loaded) posthog.captureException(error)
}
