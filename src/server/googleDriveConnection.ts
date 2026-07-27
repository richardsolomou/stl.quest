import { GoogleDriveAssetStore } from '../adapters/googleDrive'
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

export async function publicGoogleDriveConnection(deployment: SettingStore, workspace: SettingStore): Promise<PublicCloudConnection> {
  const connection = await cloudStorageConnection(workspace, 'google-drive')
  return {
    available: Boolean(await cloudStorageApp(deployment, 'google-drive')),
    connected: Boolean(connection?.refreshToken),
    accountName: connection?.accountName,
    accountEmail: connection?.accountEmail,
  }
}

export async function beginGoogleDriveAuthorization(
  app: CloudStorageApp,
  workspace: SettingStore,
  adminId: string,
  origin: string,
  returnTo: string,
) {
  const { state, stateHash, expiresAt } = createConnectionState()
  const redirectUri = googleDriveCallbackUrl(origin)
  await setPendingCloudAuthorization(workspace, { provider: 'google-drive', stateHash, adminId, redirectUri, returnTo, expiresAt })
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: SCOPES.join(' '),
    state,
  }).toString()
  return url.toString()
}

export async function completeGoogleDriveAuthorization(app: CloudStorageApp, workspace: SettingStore, request: Request, adminId: string) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const stored = await workspaceCloudStorage(workspace)
  const pending = stored.pending
  if (!code || !state || pending?.provider !== 'google-drive') {
    throw new Response('Google Drive connection request is incomplete', { status: 400 })
  }
  if (!connectionStateMatches(pending, state, adminId)) {
    throw new Response('Google Drive connection request expired or did not match', { status: 400 })
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
  const latest = (await workspaceCloudStorage(workspace)).pending
  if (!latest || !hashesMatch(latest.stateHash, pending.stateHash)) {
    throw new Response('Google Drive connection request was replaced', { status: 409 })
  }
  await setCloudStorageConnection(workspace, 'google-drive', next)
  await setPendingCloudAuthorization(workspace, undefined)
  logger.info(
    { event: 'cloud_authorization_completed', provider: 'google_drive', posthogDistinctId: adminId },
    'cloud authorization completed',
  )
  return pending.returnTo
}

export async function disconnectGoogleDrive(workspace: SettingStore) {
  await setCloudStorageConnection(workspace, 'google-drive', undefined)
}
