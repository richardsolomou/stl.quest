import crypto from 'node:crypto'
import { OneDriveAssetStore } from '../adapters/oneDrive'
import type { IntegrationConfig, OneDriveConnectionConfig, PublicCloudConnection } from '../core/auth'
import type { Repository } from '../core/types'
import { getStoredIntegrationConfig, setStoredIntegrationConfig } from './integrations'

const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const PROFILE_URL = 'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName'
const STATE_TTL = 10 * 60 * 1_000
const SCOPES = ['offline_access', 'User.Read', 'Files.ReadWrite']

export class OneDrivePermissionError extends Error {
  constructor(readonly returnTo: string) {
    super('OneDrive did not grant the required Files.ReadWrite permission')
  }
}

export function oneDriveCallbackUrl(origin: string) {
  return `${origin}/api/storage/onedrive/callback`
}

export function publicOneDriveConnection(repository: Repository, origin: string): PublicCloudConnection {
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
  repository: Repository,
  input: { clientId: string; clientSecret: string },
  adminId: string,
  origin: string,
  returnTo: string,
) {
  const config = integrationConfig(repository)
  const current = config.oneDrive
  const clientSecret = input.clientSecret || current?.clientSecret
  if (!clientSecret) throw new Response('Microsoft client secret is required', { status: 400 })
  const state = crypto.randomBytes(32).toString('base64url')
  const redirectUri = oneDriveCallbackUrl(origin)
  const oneDrive: OneDriveConnectionConfig = {
    ...(current ?? { clientId: input.clientId, clientSecret }),
    pending: {
      clientId: input.clientId,
      clientSecret,
      stateHash: hash(state),
      adminId,
      redirectUri,
      returnTo,
      expiresAt: Date.now() + STATE_TTL,
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

export async function completeOneDriveAuthorization(repository: Repository, request: Request, adminId: string) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const config = integrationConfig(repository)
  const connection = config.oneDrive
  const pending = connection?.pending
  if (!code || !state || !connection || !pending) throw new Response('OneDrive connection request is incomplete', { status: 400 })
  if (pending.expiresAt < Date.now() || pending.adminId !== adminId || !safeEqual(pending.stateHash, hash(state))) {
    throw new Response('OneDrive connection request expired or did not match', { status: 400 })
  }
  const tokenResponse = await fetch(TOKEN_URL, {
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
  const accountResponse = await fetch(PROFILE_URL, { headers: { authorization: `Bearer ${tokens.access_token}` } })
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
  const latest = integrationConfig(repository)
  if (!latest.oneDrive?.pending || !safeEqual(latest.oneDrive.pending.stateHash, pending.stateHash)) {
    throw new Response('OneDrive connection request was replaced', { status: 409 })
  }
  setStoredIntegrationConfig(repository, { ...latest, oneDrive: next })
  return pending.returnTo
}

export function disconnectOneDrive(repository: Repository) {
  const config = integrationConfig(repository)
  setStoredIntegrationConfig(repository, { ...config, oneDrive: undefined })
}

function integrationConfig(repository: Repository): IntegrationConfig {
  return getStoredIntegrationConfig(repository) ?? { passwordEnabled: true }
}

function hash(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes)
}
