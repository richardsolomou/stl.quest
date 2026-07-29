import { GoogleDriveAssetStore } from '../adapters/googleDrive'
import type { CloudStorageApp } from '../core/auth'
import { beginCloudAuthorization, completeCloudAuthorization, requireCloudAuthorizationCallback } from './cloudConnectionState'
import type { SettingStore } from './integrations'
import { exchangeOAuthAuthorizationCode, fetchOAuthProfile } from './oauthConnection'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USER_INFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file']

export class GoogleDrivePermissionError extends Error {
  constructor(readonly returnTo: string) {
    super('Google Drive did not grant the required drive.file permission')
  }
}

export function googleDriveCallbackUrl(origin: string) {
  return `${origin}/api/storage/google-drive/callback`
}

export async function beginGoogleDriveAuthorization(
  app: CloudStorageApp,
  workspace: SettingStore,
  adminId: string,
  origin: string,
  returnTo: string,
) {
  const redirectUri = googleDriveCallbackUrl(origin)
  return beginCloudAuthorization(workspace, 'google-drive', adminId, redirectUri, returnTo, AUTHORIZE_URL, {
    client_id: app.clientId,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: SCOPES.join(' '),
  })
}

export async function completeGoogleDriveAuthorization(app: CloudStorageApp, workspace: SettingStore, request: Request, adminId: string) {
  const { code, pending, stored } = await requireCloudAuthorizationCallback(workspace, 'google-drive', request, adminId)
  const tokens = await exchangeOAuthAuthorizationCode({
    url: TOKEN_URL,
    provider: 'Google',
    app,
    code,
    redirectUri: pending.redirectUri,
  })
  const refreshToken = tokens.refresh_token ?? stored.connections?.['google-drive']?.refreshToken
  if (!refreshToken) throw new Response('Google did not return an offline refresh token', { status: 502 })
  const account = await fetchOAuthProfile<{ sub: string; email?: string; name?: string }>(USER_INFO_URL, tokens.access_token, 'Google')
  const next = {
    refreshToken,
    accountId: account.sub,
    accountName: account.name,
    accountEmail: account.email,
    connectedAt: Date.now(),
  }
  try {
    await new GoogleDriveAssetStore('', { ...app, refreshToken }).writable()
  } catch (error) {
    if ([401, 403].includes((error as { status?: number }).status ?? 0)) throw new GoogleDrivePermissionError(pending.returnTo)
    throw error
  }
  return completeCloudAuthorization(workspace, 'google-drive', pending, next, adminId)
}
