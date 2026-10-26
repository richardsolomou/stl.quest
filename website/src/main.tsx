import { PostHogErrorBoundary, PostHogProvider } from '@posthog/react'
import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { posthog } from 'posthog-js'
import { App } from './App'
import './styles.css'

const posthogProjectToken = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN
const posthogHost = import.meta.env.VITE_POSTHOG_HOST

if (!posthogProjectToken || !posthogHost) {
  if (import.meta.env.DEV) {
    const missingVariable = !posthogProjectToken ? 'VITE_POSTHOG_PROJECT_TOKEN' : 'VITE_POSTHOG_HOST'
    throw new Error(
      `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
    )
  }
} else {
  posthog.init(posthogProjectToken, {
    api_host: posthogHost,
    ui_host: import.meta.env.VITE_POSTHOG_UI_HOST,
    defaults: '2026-06-25',
    capture_dead_clicks: true,
    capture_exceptions: {
      capture_console_errors: false,
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
    },
    capture_heatmaps: true,
    capture_performance: { network_timing: true, web_vitals: true },
    person_profiles: 'never',
    session_recording: { maskAllInputs: true },
  })
}

hydrateRoot(
  document.querySelector('#root')!,
  <StrictMode>
    <PostHogProvider client={posthog}>
      <PostHogErrorBoundary>
        <App />
      </PostHogErrorBoundary>
    </PostHogProvider>
  </StrictMode>,
)
