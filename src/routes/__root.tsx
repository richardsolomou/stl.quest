import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { useCallback } from 'react'
import { postHogEnvironment } from 'ras-stack/posthog'
import { PostHogBetterAuthIdentity, PostHogIntegration } from 'ras-stack/posthog/react'
import '@fontsource/oswald/500.css'
import '@fontsource/oswald/700.css'
import '@fontsource/zilla-slab/400.css'
import '@fontsource/zilla-slab/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/600.css'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ImpersonationBanner } from '../client/components/ImpersonationBanner'
import { UpdateNotices } from '../client/components/UpdateNotices'
import { authClient } from '../client/authClient'
import { preloadSessionQueries, sessionQuery } from '../client/queries'
import { RealtimeProvider, useWorkspaceUpdates } from '../client/realtime'
import { WorkspaceProvider } from '../client/workspace'
import { faviconHref } from '../favicon'
import appCss from '../styles.css?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'STL Quest' }],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: faviconHref(__APP_VERSION__) },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  // Seeds the query cache for SSR; afterwards the session lives in
  // react-query like all other server state, so realtime invalidation reaches it.
  loader: ({ context }) => preloadSessionQueries(context.queryClient),
  component: RootComponent,
})

const posthog = postHogEnvironment({
  projectToken: import.meta.env.VITE_POSTHOG_PROJECT_TOKEN,
  host: import.meta.env.VITE_POSTHOG_HOST,
})

// One live subscription for the whole app: any change event re-fetches every
// active query (session, requests, people, users, settings). Queries are few
// and cheap; a blanket refresh cannot go stale the way a per-event list can.
function LiveUpdates() {
  const queryClient = useQueryClient()
  const {
    data: { identity },
  } = useSuspenseQuery(sessionQuery())
  const refresh = useCallback(() => void queryClient.invalidateQueries(), [queryClient])
  useWorkspaceUpdates(identity?.workspaceId ?? '', refresh)
  return null
}

function PostHogIdentify() {
  const {
    data: { identity },
  } = useSuspenseQuery(sessionQuery())
  return (
    <PostHogBetterAuthIdentity
      authClient={authClient}
      properties={() => (identity ? { role: identity.role, super_admin: identity.superAdmin ?? false } : {})}
    />
  )
}

function RootComponent() {
  const {
    data: { identity, serverVersion, storageConfigured, telemetryEnabled },
  } = useSuspenseQuery(sessionQuery())
  const outlet = identity?.workspaceSlug ? (
    <WorkspaceProvider slug={identity.workspaceSlug}>
      <Outlet />
    </WorkspaceProvider>
  ) : (
    <Outlet />
  )
  const content = (
    <TooltipProvider>
      {outlet}
      {identity?.impersonatedBy && <ImpersonationBanner identity={identity} />}
    </TooltipProvider>
  )
  const observedContent = (
    <PostHogIntegration
      environment={telemetryEnabled ? posthog : undefined}
      options={{ autocapture: false, session_recording: { maskAllInputs: true, blockSelector: '.ph-no-capture' } }}
      fallback={
        <main className="mx-auto mt-[15vh] p-6 text-center">
          <h1>Something went wrong</h1>
          <p className="text-muted-foreground">Refresh the page to try again.</p>
        </main>
      }
    >
      {telemetryEnabled && posthog && <PostHogIdentify />}
      {content}
    </PostHogIntegration>
  )
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {identity?.workspaceId && storageConfigured ? (
          <RealtimeProvider workspaceId={identity.workspaceId}>
            <LiveUpdates />
            {observedContent}
          </RealtimeProvider>
        ) : (
          observedContent
        )}
        <UpdateNotices serverVersion={serverVersion} />
        <Toaster position="bottom-right" />
        <Scripts />
      </body>
    </html>
  )
}
