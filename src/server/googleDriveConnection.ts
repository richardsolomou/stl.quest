import crypto from 'node:crypto'
import { GoogleDriveAssetStore } from '../adapters/googleDrive'
import type { GoogleDriveConnectionConfig, IntegrationConfig, PublicCloudConnection } from '../core/auth'
import type { Repository } from '../core/types'
import { getStoredIntegrationConfig, setStoredIntegrationConfig } from './integrations'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USER_INFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const STATE_TTL = 10 * 60 * 1_000
const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file']

export class GoogleDrivePermissionError extends Error {
  constructor(readonly returnTo: string) {
    super('Google Drive did not grant the required drive.file permission')
  }
}

export function googleDriveCallbackUrl(origin: string) {
  return `${origin}/api/storage/google-drive/callback`
}

export function publicGoogleDriveConnection(repository: Repository, origin: string): PublicCloudConnection {
  const connection = getStoredIntegrationConfig(repository)?.googleDrive
  return {
    configured: Boolean(connection?.clientId && connection.clientSecret),
    connected: Boolean(connection?.refreshToken),
    clientId: connection?.clientId ?? '',
    secretConfigured: Boolean(connection?.clientSecret),
    accountName: connection?.accountName,
    accountEmail: connection?.accountEmail,
    callbackUrl: googleDriveCallbackUrl(origin),
  }
}

export function beginGoogleDriveAuthorization(
  repository: Repository,
  input: { clientId: string; clientSecret: string },
  adminId: string,
  origin: string,
  returnTo: string,
) {
  const config = integrationConfig(repository)
  const current = config.googleDrive
  const clientSecret = input.clientSecret || current?.clientSecret
  if (!clientSecret) throw new Response('Google OAuth client secret is required', { status: 400 })
  const state = crypto.randomBytes(32).toString('base64url')
  const redirectUri = googleDriveCallbackUrl(origin)
  const googleDrive: GoogleDriveConnectionConfig = {
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
  setStoredIntegrationConfig(repository, { ...config, googleDrive })
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: input.clientId,
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

export async function completeGoogleDriveAuthorization(repository: Repository, request: Request, adminId: string) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const config = integrationConfig(repository)
  const connection = config.googleDrive
  const pending = connection?.pending
  if (!code || !state || !connection || !pending) throw new Response('Google Drive connection request is incomplete', { status: 400 })
  if (pending.expiresAt < Date.now() || pending.adminId !== adminId || !safeEqual(pending.stateHash, hash(state))) {
    throw new Response('Google Drive connection request expired or did not match', { status: 400 })
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
    }),
  })
  if (!tokenResponse.ok) throw new Response(`Google token exchange failed: ${await tokenResponse.text()}`, { status: 502 })
  const tokens = (await tokenResponse.json()) as { access_token: string; refresh_token?: string }
  const refreshToken = tokens.refresh_token ?? connection.refreshToken
  if (!refreshToken) throw new Response('Google did not return an offline refresh token', { status: 502 })
  const accountResponse = await fetch(USER_INFO_URL, { headers: { authorization: `Bearer ${tokens.access_token}` } })
  if (!accountResponse.ok) throw new Response(`Google account lookup failed: ${await accountResponse.text()}`, { status: 502 })
  const account = (await accountResponse.json()) as { sub: string; email?: string; name?: string }
  const next: GoogleDriveConnectionConfig = {
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    refreshToken,
    accountId: account.sub,
    accountName: account.name,
    accountEmail: account.email,
    connectedAt: Date.now(),
  }
  try {
    await new GoogleDriveAssetStore('', next).writable()
  } catch (error) {
    if ([401, 403].includes((error as { status?: number }).status ?? 0)) throw new GoogleDrivePermissionError(pending.returnTo)
    throw error
  }
  const latest = integrationConfig(repository)
  if (!latest.googleDrive?.pending || !safeEqual(latest.googleDrive.pending.stateHash, pending.stateHash)) {
    throw new Response('Google Drive connection request was replaced', { status: 409 })
  }
  setStoredIntegrationConfig(repository, { ...latest, googleDrive: next })
  return pending.returnTo
}

export function disconnectGoogleDrive(repository: Repository) {
  const config = integrationConfig(repository)
  setStoredIntegrationConfig(repository, { ...config, googleDrive: undefined })
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
