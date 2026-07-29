import { OneDriveAssetStore } from '../adapters/oneDrive'
import type { CloudStorageApp } from '../core/auth'
import { beginCloudAuthorization, completeCloudAuthorization, requireCloudAuthorizationCallback } from './cloudConnectionState'
import type { SettingStore } from './integrations'
import { exchangeOAuthAuthorizationCode, fetchOAuthProfile } from './oauthConnection'

const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const PROFILE_URL = 'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName'
const SCOPES = ['offline_access', 'User.Read', 'Files.ReadWrite']

export class OneDrivePermissionError extends Error {
  constructor(readonly returnTo: string) {
    super('OneDrive did not grant the required Files.ReadWrite permission')
  }
}

export function oneDriveCallbackUrl(origin: string) {
  return `${origin}/api/storage/onedrive/callback`
}

export async function beginOneDriveAuthorization(
  app: CloudStorageApp,
  workspace: SettingStore,
  adminId: string,
  origin: string,
  returnTo: string,
) {
  const redirectUri = oneDriveCallbackUrl(origin)
  return beginCloudAuthorization(workspace, 'onedrive', adminId, redirectUri, returnTo, AUTHORIZE_URL, {
    client_id: app.clientId,
    response_type: 'code',
    response_mode: 'query',
    scope: SCOPES.join(' '),
  })
}

export async function completeOneDriveAuthorization(app: CloudStorageApp, workspace: SettingStore, request: Request, adminId: string) {
  const { code, pending, stored } = await requireCloudAuthorizationCallback(workspace, 'onedrive', request, adminId)
  const tokens = await exchangeOAuthAuthorizationCode({
    url: TOKEN_URL,
    provider: 'Microsoft',
    app,
    code,
    redirectUri: pending.redirectUri,
    parameters: { scope: SCOPES.join(' ') },
  })
  const refreshToken = tokens.refresh_token ?? stored.connections?.onedrive?.refreshToken
  if (!refreshToken) throw new Response('Microsoft did not return an offline refresh token', { status: 502 })
  const account = await fetchOAuthProfile<{ id: string; displayName?: string; mail?: string; userPrincipalName?: string }>(
    PROFILE_URL,
    tokens.access_token,
    'Microsoft',
  )
  const next = {
    refreshToken,
    accountId: account.id,
    accountName: account.displayName,
    accountEmail: account.mail ?? account.userPrincipalName,
    connectedAt: Date.now(),
  }
  try {
    await new OneDriveAssetStore('', { ...app, refreshToken }).writable()
  } catch (error) {
    if ([401, 403].includes((error as { status?: number }).status ?? 0)) throw new OneDrivePermissionError(pending.returnTo)
    throw error
  }
  return completeCloudAuthorization(workspace, 'onedrive', pending, next, adminId)
}
