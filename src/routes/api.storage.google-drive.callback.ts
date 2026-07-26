import { createFileRoute } from '@tanstack/react-router'
import { app, deploymentSettings } from '../server/app'
import { requireCloudStorageApp } from '../server/cloudStorage'
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
            const context = await instance.workspace(request.headers)
            if (context.identity.workspaceRole !== 'owner' && identity.role !== 'admin') throw new Response('forbidden', { status: 403 })
            const cloudApp = await requireCloudStorageApp(deploymentSettings(instance.repository), 'google-drive')
            returnTo = await completeGoogleDriveAuthorization(cloudApp, context.repository, request, identity.id)
            void instance.telemetry.capture(identity.id, 'cloud_storage_connected', { provider: 'google-drive' }).catch(() => undefined)
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
