import { Link, createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { RouteError } from './client/components/RouteError'
import { captureRenderError } from './client/posthog'
import { routeTree } from './routeTree.gen'
import { basePath, basePathRewrite } from './basePath'
import { createQueryClient } from './client/queryClient'
import { useI18n } from './client/i18n'

function NotFound() {
  const { t } = useI18n()
  return (
    <main className="mx-auto mt-[15vh] p-6 text-center">
      <h1>{t.shell.notFound.title}</h1>
      <p>
        <Link className="text-muted-foreground underline hover:text-foreground" to="/">
          {t.shell.notFound.back}
        </Link>
      </p>
    </main>
  )
}

export function getRouter() {
  const queryClient = createQueryClient()
  const router = createRouter({
    routeTree,
    // Start sets `basepath` from a build constant on every request and hydration, so the runtime base path is a rewrite.
    rewrite: basePathRewrite(basePath()),
    context: { queryClient },
    defaultPreload: 'intent',
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: NotFound,
    defaultOnCatch: captureRenderError,
  })
  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
