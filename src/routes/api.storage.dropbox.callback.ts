import { createFileRoute } from '@tanstack/react-router'
import { app } from '../server/app'
import { completeDropboxAuthorization, DropboxPermissionError } from '../server/dropboxConnection'
import { withRequestContext } from '../server/requestContext'

export const Route = createFileRoute('/api/storage/dropbox/callback')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withRequestContext(request, async () => {
          let returnTo = '/settings/storage'
          let outcome = 'error'
          try {
            const instance = await app()
            const identity = await instance.requireIdentity(request.headers)
            if (identity.role !== 'admin') throw new Response('forbidden', { status: 403 })
            returnTo = await completeDropboxAuthorization(instance.repository, request, identity.id)
            outcome = 'connected'
          } catch (error) {
            if (error instanceof DropboxPermissionError) {
              returnTo = error.returnTo
              outcome = 'missing-scopes'
            }
          }
          const url = new URL(returnTo, request.url)
          url.searchParams.set('cloud', 'dropbox')
          url.searchParams.set('outcome', outcome === 'missing-scopes' ? 'missing-permissions' : outcome)
          return Response.redirect(url)
        }),
    },
  },
})
