import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { RouteError } from './client/components/RouteError'
import { routeTree } from './routeTree.gen'
import { createQueryClient } from './client/queryClient'
import { useI18n } from './client/i18n'

function NotFound() {
  const { t } = useI18n()
  return (
    <main className="mx-auto mt-[15vh] p-6 text-center">
      <h1>{t.shell.notFound.title}</h1>
      <p>
        <a className="text-muted-foreground underline hover:text-foreground" href="/">
          {t.shell.notFound.back}
        </a>
      </p>
    </main>
  )
}

export function getRouter() {
  const queryClient = createQueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: NotFound,
  })
  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
