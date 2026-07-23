import { OneDriveAssetStore } from '../adapters/oneDrive'
import { cloudFetch } from '../adapters/cloudFetch'
import type { OneDriveConnectionConfig, PublicCloudConnection } from '../core/auth'
import { connectionIntegrationConfig, connectionStateMatches, createConnectionState, hashesMatch } from './cloudConnectionState'
import { getStoredIntegrationConfig, setStoredIntegrationConfig, type SettingStore } from './integrations'
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

export function publicOneDriveConnection(repository: SettingStore, origin: string): PublicCloudConnection {
  const connection = getStoredIntegrationConfig(repository)?.oneDrive
  return {
    configured: Boolean(connection?.clientId && connection.clientSecret),
    connected: Boolean(connection?.refreshToken),
    clientId: connection?.clientId ?? '',
    secretConfigured: Boolean(connection?.clientSecret),
    accountName: connection?.accountName,
    accountEmail: connection?.accountEmail,
    callbackUrl: oneDriveCallbackUrl(origin),
  }
}

export function beginOneDriveAuthorization(
  repository: SettingStore,
  input: { clientId: string; clientSecret: string },
  adminId: string,
  origin: string,
  returnTo: string,
) {
  const config = connectionIntegrationConfig(repository)
  const current = config.oneDrive
  const clientSecret = input.clientSecret || current?.clientSecret
  if (!clientSecret) throw new Response('Microsoft client secret is required', { status: 400 })
  const { state, stateHash, expiresAt } = createConnectionState()
  const redirectUri = oneDriveCallbackUrl(origin)
  const oneDrive: OneDriveConnectionConfig = {
    ...(current ?? { clientId: input.clientId, clientSecret }),
    pending: {
      clientId: input.clientId,
      clientSecret,
      stateHash,
      adminId,
      redirectUri,
      returnTo,
      expiresAt,
    },
  }
  setStoredIntegrationConfig(repository, { ...config, oneDrive })
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: SCOPES.join(' '),
    state,
  }).toString()
  return url.toString()
}

export async function completeOneDriveAuthorization(repository: SettingStore, request: Request, adminId: string) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const config = connectionIntegrationConfig(repository)
  const connection = config.oneDrive
  const pending = connection?.pending
  if (!code || !state || !connection || !pending) throw new Response('OneDrive connection request is incomplete', { status: 400 })
  if (!connectionStateMatches(pending, state, adminId)) {
    throw new Response('OneDrive connection request expired or did not match', { status: 400 })
  }
  const tokenResponse = await cloudFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: pending.clientId,
      client_secret: pending.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: pending.redirectUri,
      scope: SCOPES.join(' '),
    }),
  })
  if (!tokenResponse.ok) throw new Response(`Microsoft token exchange failed: ${await tokenResponse.text()}`, { status: 502 })
  const tokens = (await tokenResponse.json()) as { access_token: string; refresh_token?: string }
  const refreshToken = tokens.refresh_token ?? connection.refreshToken
  if (!refreshToken) throw new Response('Microsoft did not return an offline refresh token', { status: 502 })
  const accountResponse = await cloudFetch(PROFILE_URL, { headers: { authorization: `Bearer ${tokens.access_token}` } })
  if (!accountResponse.ok) throw new Response(`Microsoft account lookup failed: ${await accountResponse.text()}`, { status: 502 })
  const account = (await accountResponse.json()) as { id: string; displayName?: string; mail?: string; userPrincipalName?: string }
  const next: OneDriveConnectionConfig = {
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    refreshToken,
    accountId: account.id,
    accountName: account.displayName,
    accountEmail: account.mail ?? account.userPrincipalName,
    connectedAt: Date.now(),
  }
  try {
    await new OneDriveAssetStore('', next).writable()
  } catch (error) {
    if ([401, 403].includes((error as { status?: number }).status ?? 0)) throw new OneDrivePermissionError(pending.returnTo)
    throw error
  }
  const latest = connectionIntegrationConfig(repository)
  if (!latest.oneDrive?.pending || !hashesMatch(latest.oneDrive.pending.stateHash, pending.stateHash)) {
    throw new Response('OneDrive connection request was replaced', { status: 409 })
  }
  setStoredIntegrationConfig(repository, { ...latest, oneDrive: next })
  logger.info(
    { event: 'cloud_authorization_completed', provider: 'one_drive', posthogDistinctId: adminId },
    'cloud authorization completed',
  )
  return pending.returnTo
}

export function disconnectOneDrive(repository: SettingStore) {
  const config = connectionIntegrationConfig(repository)
  setStoredIntegrationConfig(repository, { ...config, oneDrive: undefined })
}
