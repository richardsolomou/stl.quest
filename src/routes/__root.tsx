import type { QueryClient } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { PostHogErrorBoundary, PostHogProvider, usePostHog } from '@posthog/react'
import { useEffect } from 'react'
import { whoami } from '../server/fns'
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
  loader: () => whoami(),
  component: RootComponent,
})

function PostHogIdentify() {
  const { email, name } = Route.useLoaderData()
  const posthog = usePostHog()

  useEffect(() => {
    posthog.identify(email, { name })
  }, [posthog, email, name])

  return null
}

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <PostHogProvider
          apiKey={import.meta.env.VITE_POSTHOG_PROJECT_TOKEN!}
          options={{
            api_host: '/ingest',
            ui_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.posthog.com',
            defaults: '2025-05-24',
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
            <Outlet />
          </PostHogErrorBoundary>
        </PostHogProvider>
        <Scripts />
      </body>
    </html>
  )
}
