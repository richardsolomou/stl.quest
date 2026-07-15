import crypto from 'node:crypto'
import type { DropboxConnectionConfig, IntegrationConfig, PublicDropboxConnection } from '../core/auth'
import type { Repository } from '../core/types'
import { getStoredIntegrationConfig, setStoredIntegrationConfig } from './integrations'

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize'
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const API_URL = 'https://api.dropboxapi.com/2'
const CONTENT_URL = 'https://content.dropboxapi.com/2'
const ACCOUNT_URL = `${API_URL}/users/get_current_account`
const STATE_TTL = 10 * 60 * 1_000

export const DROPBOX_REQUIRED_SCOPES = ['account_info.read', 'files.metadata.read', 'files.content.read', 'files.content.write'] as const

export class DropboxPermissionError extends Error {
  constructor(
    readonly returnTo: string,
    readonly missingScopes: string[],
  ) {
    super(`Dropbox is missing required permissions: ${missingScopes.join(', ')}`)
    this.name = 'DropboxPermissionError'
  }
}

export function dropboxCallbackUrl(origin: string) {
  return `${origin}/api/storage/dropbox/callback`
}

export function publicDropboxConnection(repository: Repository, origin: string): PublicDropboxConnection {
  const connection = getStoredIntegrationConfig(repository)?.dropbox
  return {
    configured: Boolean(connection?.clientId && connection.clientSecret),
    connected: Boolean(connection?.refreshToken),
    clientId: connection?.clientId ?? '',
    secretConfigured: Boolean(connection?.clientSecret),
    accountName: connection?.accountName,
    accountEmail: connection?.accountEmail,
    callbackUrl: dropboxCallbackUrl(origin),
  }
}

export function beginDropboxAuthorization(
  repository: Repository,
  input: { clientId: string; clientSecret: string },
  adminId: string,
  origin: string,
  returnTo: string,
) {
  const config = integrationConfig(repository)
  const current = config.dropbox
  const clientSecret = input.clientSecret || current?.clientSecret
  if (!clientSecret) throw new Response('Dropbox app secret is required', { status: 400 })
  const state = crypto.randomBytes(32).toString('base64url')
  const redirectUri = dropboxCallbackUrl(origin)
  const dropbox: DropboxConnectionConfig = {
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
  setStoredIntegrationConfig(repository, { ...config, dropbox })
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: input.clientId,
    response_type: 'code',
    token_access_type: 'offline',
    force_reapprove: 'true',
    redirect_uri: redirectUri,
    state,
  }).toString()
  return url.toString()
}

export async function completeDropboxAuthorization(repository: Repository, request: Request, adminId: string) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const config = integrationConfig(repository)
  const connection = config.dropbox
  const pending = connection?.pending
  if (!code || !state || !connection || !pending) throw new Response('Dropbox connection request is incomplete', { status: 400 })
  if (pending.expiresAt < Date.now() || pending.adminId !== adminId || !safeEqual(pending.stateHash, hash(state))) {
    throw new Response('Dropbox connection request expired or did not match', { status: 400 })
  }
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${pending.clientId}:${pending.clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: pending.redirectUri }),
  })
  if (!tokenResponse.ok) throw new Response(`Dropbox token exchange failed: ${await tokenResponse.text()}`, { status: 502 })
  const tokens = (await tokenResponse.json()) as { access_token: string; refresh_token?: string; account_id?: string }
  if (!tokens.refresh_token) throw new Response('Dropbox did not return an offline refresh token', { status: 502 })
  const accountResponse = await fetch(ACCOUNT_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' },
    body: 'null',
  })
  if (!accountResponse.ok) {
    const body = await accountResponse.text()
    const missingScope = requiredDropboxScope(body)
    if (missingScope) throw new DropboxPermissionError(pending.returnTo, [missingScope])
    throw new Response(`Dropbox account lookup failed: ${body}`, { status: 502 })
  }
  const account = (await accountResponse.json()) as {
    account_id: string
    email?: string
    name?: { display_name?: string }
  }
  await validateDropboxCapabilities(tokens.access_token, pending.returnTo)
  setStoredIntegrationConfig(repository, {
    ...config,
    dropbox: {
      clientId: pending.clientId,
      clientSecret: pending.clientSecret,
      refreshToken: tokens.refresh_token,
      accountId: account.account_id || tokens.account_id,
      accountName: account.name?.display_name,
      accountEmail: account.email,
      connectedAt: Date.now(),
    },
  })
  return pending.returnTo
}

export function disconnectDropbox(repository: Repository) {
  const config = integrationConfig(repository)
  setStoredIntegrationConfig(repository, { ...config, dropbox: undefined })
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

async function validateDropboxCapabilities(accessToken: string, returnTo: string) {
  const probe = `/.printhub-connection-check-${crypto.randomUUID()}`
  const movedProbe = `${probe}-moved`
  let cleaned = false
  try {
    const metadata = await dropboxRpc(accessToken, '/files/get_metadata', { path: probe })
    if (metadata.ok || metadata.status !== 409 || !(await metadata.text()).includes('not_found')) {
      await requireDropboxResponse(metadata)
      throw new Error('Dropbox permission probe path unexpectedly exists')
    }

    await requireDropboxResponse(
      await dropboxContent(accessToken, '/files/upload', { path: probe, mode: 'overwrite', autorename: false, mute: true }, 'PrintHub'),
    )
    await requireDropboxResponse(await dropboxContent(accessToken, '/files/download', { path: probe }))
    await requireDropboxResponse(
      await dropboxRpc(accessToken, '/files/move_v2', {
        from_path: probe,
        to_path: movedProbe,
        autorename: false,
        allow_ownership_transfer: false,
      }),
    )
    await requireDropboxResponse(await dropboxRpc(accessToken, '/files/delete_v2', { path: movedProbe }))
    cleaned = true
  } catch (error) {
    if (error instanceof DropboxScopeProbeError) throw new DropboxPermissionError(returnTo, [error.scope])
    throw error
  } finally {
    if (!cleaned) {
      await Promise.allSettled([
        dropboxRpc(accessToken, '/files/delete_v2', { path: probe }),
        dropboxRpc(accessToken, '/files/delete_v2', { path: movedProbe }),
      ])
    }
  }
}

function dropboxRpc(accessToken: string, route: string, body: unknown) {
  return fetch(`${API_URL}${route}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function dropboxContent(accessToken: string, route: string, argument: unknown, body?: string) {
  return fetch(`${CONTENT_URL}${route}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/octet-stream',
      'dropbox-api-arg': JSON.stringify(argument),
    },
    body,
  })
}

async function requireDropboxResponse(response: Response) {
  if (response.ok) return
  const body = await response.text()
  const missingScope = requiredDropboxScope(body)
  if (missingScope) throw new DropboxScopeProbeError(missingScope)
  throw new Response(`Dropbox permission check failed (${response.status}): ${body}`, { status: 502 })
}

function requiredDropboxScope(body: string) {
  return body.match(/required scope ['"]([^'"]+)['"]/)?.[1]
}

class DropboxScopeProbeError extends Error {
  readonly scope: string

  constructor(scope: string) {
    super(`Dropbox scope probe failed: ${scope}`)
    this.scope = scope
  }
}
