import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext, useRouterState } from '@tanstack/react-router'
import { useCallback } from 'react'
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
import { chunkRecoveryScript } from '../client/chunkRecovery'
import { preloadSessionQueries, sessionQuery } from '../client/queries'
import { RealtimeProvider } from '../client/useRealtime'
import { useWorkspaceUpdates } from '../client/workspaceUpdates'
import { translationGuardScript } from '../client/translationGuard'
import { PostHogIntegration } from '../client/posthog'
import { PostHogIdentity } from '../client/postHogIdentity'
import { themeScript } from '../client/theme'
import { WorkspaceProvider } from '../client/workspace'
import { faviconHref } from '../favicon'
import { appPath, assetPath, basePath, basePathMetaName } from '../basePath'
import { DEFAULT_LOCALE, messagesFor } from '../core/i18n'
import { showsEnglishLandingPage } from '../client/landing/site'
import { I18nProvider } from '../client/i18n'
import appCss from '../styles.css?url'

// What a shared link, such as an invitation, unfurls as in chat apps.
const description = 'A private 3D-print request and production queue for resin and filament printers.'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'STL Quest' },
      { name: 'description', content: description },
      // Pages sit behind a sign-in, and a self-hosted instance should not be findable by searching; the hosted landing pages override this.
      { name: 'robots', content: 'noindex, nofollow' },
      { property: 'og:title', content: 'STL Quest' },
      { property: 'og:description', content: description },
      { property: 'og:site_name', content: 'STL Quest' },
      { name: basePathMetaName, content: basePath() },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: faviconHref(__APP_VERSION__) },
      { rel: 'stylesheet', href: assetPath(appCss) },
    ],
    scripts: [{ children: themeScript }, { children: chunkRecoveryScript }, { children: translationGuardScript }],
  }),
  // Seeds the query cache for SSR; afterwards the session lives in
  // react-query like all other server state, so realtime invalidation reaches it.
  loader: ({ context }) => preloadSessionQueries(context.queryClient),
  component: RootComponent,
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
  useWorkspaceUpdates(identity?.workspaceId ?? '', refresh, leaveDeletedWorkspace)
  return null
}

// The server moves the session to another workspace, or a new personal one, on the next page load.
const leaveDeletedWorkspace = () => window.location.assign(appPath('/'))

function RootComponent() {
  const { data: session } = useSuspenseQuery(sessionQuery())
  const { identity, serverVersion, storageConfigured, telemetryEnabled } = session
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const locale = showsEnglishLandingPage(session, pathname) ? DEFAULT_LOCALE : session.locale
  const t = messagesFor(locale)
  const outlet = identity?.workspaceSlug ? (
    <WorkspaceProvider slug={identity.workspaceSlug}>
      <Outlet />
    </WorkspaceProvider>
  ) : (
    <Outlet />
  )
  const content = (
    <>
      <PostHogIdentity properties={identity ? { role: identity.role, super_admin: identity.superAdmin ?? false } : undefined} />
      <TooltipProvider>
        {outlet}
        {identity?.impersonatedBy && <ImpersonationBanner identity={identity} />}
      </TooltipProvider>
    </>
  )
  const observedContent = (
    <PostHogIntegration
      enabled={telemetryEnabled}
      fallback={
        <main className="mx-auto mt-[15vh] p-6 text-center">
          <h1>{t.common.somethingWentWrong}</h1>
          <p className="text-muted-foreground">{t.common.refreshToRetry}</p>
        </main>
      }
    >
      {identity?.workspaceId && storageConfigured ? (
        // The connection token follows the workspace, so a switch reconnects.
        <RealtimeProvider key={identity.workspaceId}>
          <LiveUpdates />
          {content}
        </RealtimeProvider>
      ) : (
        content
      )}
    </PostHogIntegration>
  )
  return (
    // The theme script sets data-theme before hydration.
    <html lang={locale} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nProvider locale={locale}>
          {observedContent}
          <UpdateNotices serverVersion={serverVersion} />
          <Toaster position="bottom-right" />
        </I18nProvider>
        <Scripts />
      </body>
    </html>
  )
}
