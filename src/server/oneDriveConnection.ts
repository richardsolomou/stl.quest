import { OneDriveAssetStore } from '../adapters/oneDrive'
import { cloudFetch } from '../adapters/cloudFetch'
import type { CloudStorageApp, PublicCloudConnection } from '../core/auth'
import { connectionStateMatches, createConnectionState, hashesMatch } from './cloudConnectionState'
import {
  cloudStorageApp,
  cloudStorageConnection,
  setCloudStorageConnection,
  setPendingCloudAuthorization,
  workspaceCloudStorage,
} from './cloudStorage'
import type { SettingStore } from './integrations'
import { logger } from './logger'

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

export async function publicOneDriveConnection(deployment: SettingStore, workspace: SettingStore): Promise<PublicCloudConnection> {
  const connection = await cloudStorageConnection(workspace, 'onedrive')
  return {
    available: Boolean(await cloudStorageApp(deployment, 'onedrive')),
    connected: Boolean(connection?.refreshToken),
    accountName: connection?.accountName,
    accountEmail: connection?.accountEmail,
  }
}

export async function beginOneDriveAuthorization(
  app: CloudStorageApp,
  workspace: SettingStore,
  adminId: string,
  origin: string,
  returnTo: string,
) {
  const { state, stateHash, expiresAt } = createConnectionState()
  const redirectUri = oneDriveCallbackUrl(origin)
  await setPendingCloudAuthorization(workspace, { provider: 'onedrive', stateHash, adminId, redirectUri, returnTo, expiresAt })
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: SCOPES.join(' '),
    state,
  }).toString()
  return url.toString()
}

export async function completeOneDriveAuthorization(app: CloudStorageApp, workspace: SettingStore, request: Request, adminId: string) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const stored = await workspaceCloudStorage(workspace)
  const pending = stored.pending
  if (!code || !state || pending?.provider !== 'onedrive') throw new Response('OneDrive connection request is incomplete', { status: 400 })
  if (!connectionStateMatches(pending, state, adminId)) {
    throw new Response('OneDrive connection request expired or did not match', { status: 400 })
  }
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
  const latest = (await workspaceCloudStorage(workspace)).pending
  if (!latest || !hashesMatch(latest.stateHash, pending.stateHash)) {
    throw new Response('OneDrive connection request was replaced', { status: 409 })
  }
  await setCloudStorageConnection(workspace, 'onedrive', next)
  await setPendingCloudAuthorization(workspace, undefined)
  logger.info(
    { event: 'cloud_authorization_completed', provider: 'one_drive', posthogDistinctId: adminId },
    'cloud authorization completed',
  )
  return pending.returnTo
}

export async function disconnectOneDrive(workspace: SettingStore) {
  await setCloudStorageConnection(workspace, 'onedrive', undefined)
}
