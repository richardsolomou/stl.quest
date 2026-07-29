import crypto from 'node:crypto'
import type { CloudStorageApp } from '../core/auth'
import { cloudFetch } from '../adapters/cloudFetch'
import { beginCloudAuthorization, completeCloudAuthorization, requireCloudAuthorizationCallback } from './cloudConnectionState'
import type { SettingStore } from './integrations'
import { exchangeOAuthAuthorizationCode } from './oauthConnection'

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize'
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const API_URL = 'https://api.dropboxapi.com/2'
const CONTENT_URL = 'https://content.dropboxapi.com/2'
const ACCOUNT_URL = `${API_URL}/users/get_current_account`

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

export async function beginDropboxAuthorization(
  app: CloudStorageApp,
  workspace: SettingStore,
  adminId: string,
  origin: string,
  returnTo: string,
) {
  const redirectUri = dropboxCallbackUrl(origin)
  return beginCloudAuthorization(workspace, 'dropbox', adminId, redirectUri, returnTo, AUTHORIZE_URL, {
    client_id: app.clientId,
    response_type: 'code',
    token_access_type: 'offline',
    force_reapprove: 'true',
  })
}

export async function completeDropboxAuthorization(app: CloudStorageApp, workspace: SettingStore, request: Request, adminId: string) {
  const { code, pending } = await requireCloudAuthorizationCallback(workspace, 'dropbox', request, adminId)
  const tokens = await exchangeOAuthAuthorizationCode<{ access_token: string; refresh_token?: string; account_id?: string }>({
    url: TOKEN_URL,
    provider: 'Dropbox',
    app,
    code,
    redirectUri: pending.redirectUri,
    clientAuthentication: 'basic',
  })
  if (!tokens.refresh_token) throw new Response('Dropbox did not return an offline refresh token', { status: 502 })
  const accountResponse = await cloudFetch(ACCOUNT_URL, {
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
  return completeCloudAuthorization(
    workspace,
    'dropbox',
    pending,
    {
      refreshToken: tokens.refresh_token,
      accountId: account.account_id || tokens.account_id,
      accountName: account.name?.display_name,
      accountEmail: account.email,
      connectedAt: Date.now(),
    },
    adminId,
  )
}

async function validateDropboxCapabilities(accessToken: string, returnTo: string) {
  const probe = `/.stlquest-connection-check-${crypto.randomUUID()}`
  const movedProbe = `${probe}-moved`
  let cleaned = false
  try {
    const metadata = await dropboxRpc(accessToken, '/files/get_metadata', { path: probe })
    if (metadata.ok || metadata.status !== 409 || !(await metadata.text()).includes('not_found')) {
      await requireDropboxResponse(metadata)
      throw new Error('Dropbox permission probe path unexpectedly exists')
    }

    await requireDropboxResponse(
      await dropboxContent(accessToken, '/files/upload', { path: probe, mode: 'overwrite', autorename: false, mute: true }, 'STL Quest'),
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
  return cloudFetch(`${API_URL}${route}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function dropboxContent(accessToken: string, route: string, argument: unknown, body?: string) {
  return cloudFetch(`${CONTENT_URL}${route}`, {
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
