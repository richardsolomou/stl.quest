import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { PostHogErrorBoundary, PostHogProvider, usePostHog } from '@posthog/react'
import { useEffect } from 'react'
import { sessionQuery } from '../client/queries'
import { TELEMETRY_HOST, TELEMETRY_TOKEN } from '../core/telemetry'
import appCss from '../styles.css?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'PrintHub' },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&display=swap',
      },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  // Seeds the query cache for SSR; afterwards the session lives in
  // react-query like all other server state, so SSE invalidation reaches it.
  loader: ({ context }) => context.queryClient.ensureQueryData(sessionQuery()),
  component: RootComponent,
})

// One live-update stream for the whole app: any change event re-fetches every
// active query (session, requests, people, users, settings). Queries are few
// and cheap; a blanket refresh cannot go stale the way a per-event list can.
function LiveUpdates() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const events = new EventSource('/api/events')
    const refresh = () => void queryClient.invalidateQueries()
    events.onopen = refresh
    events.addEventListener('change', refresh)
    return () => events.close()
  }, [queryClient])
  return null
}

function PostHogIdentify() {
  const { data: { identity } } = useSuspenseQuery(sessionQuery())
  const posthog = usePostHog()

  useEffect(() => {
    if (identity) posthog.identify(identity.id)
  }, [posthog, identity])

  return null
}

function RootComponent() {
  const { data: { identity, telemetryEnabled } } = useSuspenseQuery(sessionQuery())
  const content = <Outlet />
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {identity && <LiveUpdates />}
        {telemetryEnabled ? <PostHogProvider
          apiKey={TELEMETRY_TOKEN}
          options={{
            api_host: TELEMETRY_HOST,
            ui_host: 'https://us.posthog.com',
            defaults: '2026-05-30',
            autocapture: false,
            disable_session_recording: true,
            capture_exceptions: true,
            debug: import.meta.env.DEV,
          }}
        >
          <PostHogIdentify />
          <PostHogErrorBoundary
            fallback={
              <main className="fatal-error">
                <h1>Something went wrong</h1>
                <p>Refresh the page to try again.</p>
              </main>
            }
          >
            {content}
          </PostHogErrorBoundary>
        </PostHogProvider> : content}
        <Scripts />
      </body>
    </html>
  )
}
