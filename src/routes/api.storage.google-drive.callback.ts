import { createFileRoute } from '@tanstack/react-router'
import { app } from '../server/app'
import { completeGoogleDriveAuthorization, GoogleDrivePermissionError } from '../server/googleDriveConnection'
import { withRequestContext } from '../server/requestContext'

export const Route = createFileRoute('/api/storage/google-drive/callback')({
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
            returnTo = await completeGoogleDriveAuthorization(instance.repository, request, identity.id)
            outcome = 'connected'
          } catch (error) {
            if (error instanceof GoogleDrivePermissionError) {
              returnTo = error.returnTo
              outcome = 'missing-permissions'
            }
          }
          const url = new URL(returnTo, request.url)
          url.searchParams.set('cloud', 'google-drive')
          url.searchParams.set('outcome', outcome)
          return Response.redirect(url)
        }),
    },
  },
})
