import { createFileRoute } from '@tanstack/react-router'
import { app, deploymentSettings } from '../server/app'
import { requireCloudStorageApp } from '../server/cloudStorage'
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
            const context = await instance.workspace(request.headers)
            if (context.identity.workspaceRole !== 'owner' && identity.role !== 'admin') throw new Response('forbidden', { status: 403 })
            const cloudApp = await requireCloudStorageApp(deploymentSettings(instance.repository), 'dropbox')
            returnTo = await completeDropboxAuthorization(cloudApp, context.repository, request, identity.id)
            void instance.telemetry.capture(identity.id, 'cloud_storage_connected', { provider: 'dropbox' }).catch(() => undefined)
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
