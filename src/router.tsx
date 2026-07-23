import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'
import { createQueryClient } from './client/queryClient'

export function getRouter() {
  const queryClient = createQueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultNotFoundComponent: () => (
      <main className="mx-auto mt-[15vh] p-6 text-center">
        <h1>Page not found</h1>
        <p>
          <a className="text-muted-foreground underline hover:text-foreground" href="/">
            Back to the board
          </a>
        </p>
      </main>
    ),
  })
  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
