import { OneDriveAssetStore } from '../adapters/oneDrive'
import { cloudFetch } from '../adapters/cloudFetch'
import type { CloudStorageApp } from '../core/auth'
import { beginCloudAuthorization, completeCloudAuthorization, requireCloudAuthorizationCallback } from './cloudConnectionState'
import type { SettingStore } from './integrations'

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
  const tokenResponse = await cloudFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: pending.redirectUri,
      scope: SCOPES.join(' '),
    }),
  })
  if (!tokenResponse.ok) throw new Response(`Microsoft token exchange failed: ${await tokenResponse.text()}`, { status: 502 })
  const tokens = (await tokenResponse.json()) as { access_token: string; refresh_token?: string }
  const refreshToken = tokens.refresh_token ?? stored.connections?.onedrive?.refreshToken
  if (!refreshToken) throw new Response('Microsoft did not return an offline refresh token', { status: 502 })
  const accountResponse = await cloudFetch(PROFILE_URL, { headers: { authorization: `Bearer ${tokens.access_token}` } })
  if (!accountResponse.ok) throw new Response(`Microsoft account lookup failed: ${await accountResponse.text()}`, { status: 502 })
  const account = (await accountResponse.json()) as { id: string; displayName?: string; mail?: string; userPrincipalName?: string }
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
