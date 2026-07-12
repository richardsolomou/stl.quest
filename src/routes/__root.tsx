import type { QueryClient } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { PostHogErrorBoundary, PostHogProvider, usePostHog } from '@posthog/react'
import { useEffect } from 'react'
import { sessionInfo } from '../server/fns'
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
  loader: () => sessionInfo(),
  component: RootComponent,
})

function PostHogIdentify() {
  const { identity } = Route.useLoaderData()
  const posthog = usePostHog()

  useEffect(() => {
    if (identity) posthog.identify(identity.id)
  }, [posthog, identity])

  return null
}

function RootComponent() {
  const { telemetryEnabled } = Route.useLoaderData()
  const content = <Outlet />
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
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
