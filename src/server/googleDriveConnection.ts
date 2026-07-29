import { GoogleDriveAssetStore } from '../adapters/googleDrive'
import { cloudFetch } from '../adapters/cloudFetch'
import type { CloudStorageApp } from '../core/auth'
import { beginCloudAuthorization, completeCloudAuthorization, requireCloudAuthorizationCallback } from './cloudConnectionState'
import type { SettingStore } from './integrations'

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
  const tokenResponse = await cloudFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: pending.redirectUri,
    }),
  })
  if (!tokenResponse.ok) throw new Response(`Google token exchange failed: ${await tokenResponse.text()}`, { status: 502 })
  const tokens = (await tokenResponse.json()) as { access_token: string; refresh_token?: string }
  const refreshToken = tokens.refresh_token ?? stored.connections?.['google-drive']?.refreshToken
  if (!refreshToken) throw new Response('Google did not return an offline refresh token', { status: 502 })
  const accountResponse = await cloudFetch(USER_INFO_URL, { headers: { authorization: `Bearer ${tokens.access_token}` } })
  if (!accountResponse.ok) throw new Response(`Google account lookup failed: ${await accountResponse.text()}`, { status: 502 })
  const account = (await accountResponse.json()) as { sub: string; email?: string; name?: string }
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
