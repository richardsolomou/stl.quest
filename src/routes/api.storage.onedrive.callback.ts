import { createFileRoute } from '@tanstack/react-router'
import { app, deploymentSettings } from '../server/app'
import { completeOneDriveAuthorization, OneDrivePermissionError } from '../server/oneDriveConnection'
import { withRequestContext } from '../server/requestContext'

export const Route = createFileRoute('/api/storage/onedrive/callback')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withRequestContext(request, async () => {
          let returnTo = '/settings/storage'
          let outcome = 'error'
          try {
            const instance = await app()
            const identity = await instance.requireIdentity(request.headers)
            if (!identity.superAdmin) throw new Response('forbidden', { status: 403 })
            returnTo = await completeOneDriveAuthorization(deploymentSettings(instance.repository), request, identity.id)
            void instance.telemetry.capture(identity.id, 'cloud_storage_connected', { provider: 'onedrive' }).catch(() => undefined)
            outcome = 'connected'
          } catch (error) {
            if (error instanceof OneDrivePermissionError) {
              returnTo = error.returnTo
              outcome = 'missing-permissions'
            }
          }
          const url = new URL(returnTo, request.url)
          url.searchParams.set('cloud', 'onedrive')
          url.searchParams.set('outcome', outcome)
          return Response.redirect(url)
        }),
    },
  },
})
