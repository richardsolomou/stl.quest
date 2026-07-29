import { BoxAssetStore } from '../adapters/box'
import type { CloudStorageApp } from '../core/auth'
import { beginCloudAuthorization, completeCloudAuthorization, requireCloudAuthorizationCallback } from './cloudConnectionState'
import type { SettingStore } from './integrations'
import { exchangeOAuthAuthorizationCode, fetchOAuthProfile } from './oauthConnection'

const AUTHORIZE_URL = 'https://account.box.com/api/oauth2/authorize'
const TOKEN_URL = 'https://api.box.com/oauth2/token'
const PROFILE_URL = 'https://api.box.com/2.0/users/me?fields=id,name,login'

export class BoxPermissionError extends Error {
  constructor(readonly returnTo: string) {
    super('Box did not grant read and write access')
  }
}

export function boxCallbackUrl(origin: string) {
  return `${origin}/api/storage/box/callback`
}

export async function beginBoxAuthorization(
  app: CloudStorageApp,
  workspace: SettingStore,
  adminId: string,
  origin: string,
  returnTo: string,
) {
  const redirectUri = boxCallbackUrl(origin)
  return beginCloudAuthorization(workspace, 'box', adminId, redirectUri, returnTo, AUTHORIZE_URL, {
    client_id: app.clientId,
    response_type: 'code',
  })
}

export async function completeBoxAuthorization(app: CloudStorageApp, workspace: SettingStore, request: Request, adminId: string) {
  const { code, pending } = await requireCloudAuthorizationCallback(workspace, 'box', request, adminId)
  const tokens = await exchangeOAuthAuthorizationCode({ url: TOKEN_URL, provider: 'Box', app, code, redirectUri: pending.redirectUri })
  if (!tokens.refresh_token) throw new Response('Box did not return an offline refresh token', { status: 502 })
  const account = await fetchOAuthProfile<{ id: string; name?: string; login?: string }>(PROFILE_URL, tokens.access_token, 'Box')
  const next = {
    refreshToken: tokens.refresh_token,
    accountId: account.id,
    accountName: account.name,
    accountEmail: account.login,
    connectedAt: Date.now(),
  }
  try {
    await new BoxAssetStore('', { ...app, refreshToken: tokens.refresh_token }).writable()
  } catch (error) {
    if ([401, 403].includes((error as { status?: number }).status ?? 0)) throw new BoxPermissionError(pending.returnTo)
    throw error
  }
  return completeCloudAuthorization(workspace, 'box', pending, next, adminId)
}
