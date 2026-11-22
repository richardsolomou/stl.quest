import type { CloudStorageApp, CloudStorageProvider } from '../core/auth'
import { beginBoxAuthorization, completeBoxAuthorization } from './boxConnection'
import { app, deploymentSettings } from './app'
import { requireCloudStorageApp } from './cloudStorage'
import { CloudPermissionError } from './cloudConnectionState'
import { beginDropboxAuthorization, completeDropboxAuthorization } from './dropboxConnection'
import { beginGoogleDriveAuthorization, completeGoogleDriveAuthorization } from './googleDriveConnection'
import type { SettingStore } from './integrations'
import { logger } from './logger'
import { publicUrl } from './origins'
import { beginOneDriveAuthorization, completeOneDriveAuthorization } from './oneDriveConnection'
import { withRequestContext } from './requestContext'

type BeginAuthorization = (
  app: CloudStorageApp,
  workspace: SettingStore,
  adminId: string,
  origin: string,
  returnTo: string,
) => Promise<string>

const BEGIN_AUTHORIZATION = {
  dropbox: beginDropboxAuthorization,
  'google-drive': beginGoogleDriveAuthorization,
  onedrive: beginOneDriveAuthorization,
  box: beginBoxAuthorization,
} satisfies Record<CloudStorageProvider, BeginAuthorization>

const COMPLETE_AUTHORIZATION = {
  dropbox: completeDropboxAuthorization,
  'google-drive': completeGoogleDriveAuthorization,
  onedrive: completeOneDriveAuthorization,
  box: completeBoxAuthorization,
} satisfies Record<CloudStorageProvider, typeof completeDropboxAuthorization>

export function beginCloudStorageAuthorization(
  provider: CloudStorageProvider,
  cloudApp: CloudStorageApp,
  workspace: SettingStore,
  adminId: string,
  origin: string,
  returnTo: string,
) {
  return BEGIN_AUTHORIZATION[provider](cloudApp, workspace, adminId, origin, returnTo)
}

export function cloudStorageAuthorizationCallback(request: Request, provider: CloudStorageProvider) {
  return withRequestContext(request, async () => {
    let returnTo = '/settings/storage'
    let outcome = 'error'
    try {
      const instance = await app()
      const identity = await instance.requireIdentity(request.headers)
      const context = await instance.workspace(request.headers)
      if (context.identity.workspaceRole !== 'owner' && identity.role !== 'admin') throw new Response('forbidden', { status: 403 })
      const cloudApp = await requireCloudStorageApp(deploymentSettings(instance.repository), provider)
      returnTo = await COMPLETE_AUTHORIZATION[provider](cloudApp, context.repository, request, identity.id)
      instance.telemetry.capture(identity.id, 'cloud_storage_connected', { provider })
      outcome = 'connected'
    } catch (error) {
      if (error instanceof CloudPermissionError) {
        returnTo = error.returnTo
        outcome = 'missing-permissions'
      } else {
        logger.warn({ err: error, event: 'cloud_authorization_failed', provider }, 'cloud authorization failed')
      }
    }
    const url = new URL(publicUrl(request, returnTo))
    url.searchParams.set('cloud', provider)
    url.searchParams.set('outcome', outcome)
    return Response.redirect(url)
  })
}
