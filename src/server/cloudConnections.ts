import type { CloudStorageApp, CloudStorageProvider } from '../core/auth'
import { app, deploymentSettings } from './app'
import { requireCloudStorageApp } from './cloudStorage'
import { beginDropboxAuthorization, completeDropboxAuthorization, DropboxPermissionError } from './dropboxConnection'
import { beginGoogleDriveAuthorization, completeGoogleDriveAuthorization, GoogleDrivePermissionError } from './googleDriveConnection'
import type { SettingStore } from './integrations'
import { beginOneDriveAuthorization, completeOneDriveAuthorization, OneDrivePermissionError } from './oneDriveConnection'
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
} satisfies Record<CloudStorageProvider, BeginAuthorization>

const COMPLETE_AUTHORIZATION = {
  dropbox: completeDropboxAuthorization,
  'google-drive': completeGoogleDriveAuthorization,
  onedrive: completeOneDriveAuthorization,
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
      void instance.telemetry.capture(identity.id, 'cloud_storage_connected', { provider }).catch(() => undefined)
      outcome = 'connected'
    } catch (error) {
      if (isPermissionError(error, provider)) {
        returnTo = error.returnTo
        outcome = 'missing-permissions'
      }
    }
    const url = new URL(returnTo, request.url)
    url.searchParams.set('cloud', provider)
    url.searchParams.set('outcome', outcome)
    return Response.redirect(url)
  })
}

function isPermissionError(error: unknown, provider: CloudStorageProvider): error is { returnTo: string } {
  if (provider === 'dropbox') return error instanceof DropboxPermissionError
  if (provider === 'google-drive') return error instanceof GoogleDrivePermissionError
  return error instanceof OneDrivePermissionError
}
