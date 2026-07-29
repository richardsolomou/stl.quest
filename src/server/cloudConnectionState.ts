import crypto from 'node:crypto'
import { cloudStorageProviderName } from '../core/auth'
import type {
  CloudStorageConnection,
  CloudStorageProvider,
  IntegrationConfig,
  PendingCloudAuthorization,
  PublicCloudConnection,
} from '../core/auth'
import {
  cloudStorageApp,
  cloudStorageConnection,
  setCloudStorageConnection,
  setPendingCloudAuthorization,
  workspaceCloudStorage,
} from './cloudStorage'
import { getStoredIntegrationConfig, type SettingStore } from './integrations'
import { logger } from './logger'

const STATE_TTL = 10 * 60 * 1_000
const TELEMETRY_PROVIDERS = { dropbox: 'dropbox', 'google-drive': 'google_drive', onedrive: 'one_drive', box: 'box' } as const

type PendingConnection = {
  adminId: string
  expiresAt: number
  stateHash: string
}

export async function connectionIntegrationConfig(repository: SettingStore): Promise<IntegrationConfig> {
  return (await getStoredIntegrationConfig(repository)) ?? { passwordEnabled: true }
}

export function createConnectionState() {
  const state = crypto.randomBytes(32).toString('base64url')
  return { state, stateHash: hash(state), expiresAt: Date.now() + STATE_TTL }
}

export async function publicCloudConnection(
  deployment: SettingStore,
  workspace: SettingStore,
  provider: CloudStorageProvider,
): Promise<PublicCloudConnection> {
  const connection = await cloudStorageConnection(workspace, provider)
  return {
    available: Boolean(await cloudStorageApp(deployment, provider)),
    connected: Boolean(connection?.refreshToken),
    accountName: connection?.accountName,
    accountEmail: connection?.accountEmail,
  }
}

export async function beginCloudAuthorization(
  workspace: SettingStore,
  provider: CloudStorageProvider,
  adminId: string,
  redirectUri: string,
  returnTo: string,
  authorizeUrl: string,
  parameters: Record<string, string>,
) {
  const { state, stateHash, expiresAt } = createConnectionState()
  await setPendingCloudAuthorization(workspace, { provider, stateHash, adminId, redirectUri, returnTo, expiresAt })
  const url = new URL(authorizeUrl)
  url.search = new URLSearchParams({ ...parameters, redirect_uri: redirectUri, state }).toString()
  return url.toString()
}

export async function requireCloudAuthorizationCallback(
  workspace: SettingStore,
  provider: CloudStorageProvider,
  request: Request,
  adminId: string,
) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const stored = await workspaceCloudStorage(workspace)
  const pending = stored.pending
  if (!code || !state || pending?.provider !== provider) {
    throw new Response(`${cloudStorageProviderName(provider)} connection request is incomplete`, { status: 400 })
  }
  if (!connectionStateMatches(pending, state, adminId)) {
    throw new Response(`${cloudStorageProviderName(provider)} connection request expired or did not match`, { status: 400 })
  }
  return { code, pending, stored }
}

export async function completeCloudAuthorization(
  workspace: SettingStore,
  provider: CloudStorageProvider,
  pending: PendingCloudAuthorization,
  connection: CloudStorageConnection,
  adminId: string,
) {
  const latest = (await workspaceCloudStorage(workspace)).pending
  if (!latest || !hashesMatch(latest.stateHash, pending.stateHash)) {
    throw new Response(`${cloudStorageProviderName(provider)} connection request was replaced`, { status: 409 })
  }
  await setCloudStorageConnection(workspace, provider, connection)
  await setPendingCloudAuthorization(workspace, undefined)
  logger.info(
    { event: 'cloud_authorization_completed', provider: TELEMETRY_PROVIDERS[provider], posthogDistinctId: adminId },
    'cloud authorization completed',
  )
  return pending.returnTo
}

export function disconnectCloudStorage(workspace: SettingStore, provider: CloudStorageProvider) {
  return setCloudStorageConnection(workspace, provider, undefined)
}

export function connectionStateMatches(pending: PendingConnection, state: string, adminId: string) {
  return pending.expiresAt >= Date.now() && pending.adminId === adminId && hashesMatch(pending.stateHash, hash(state))
}

export function hashesMatch(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes)
}

function hash(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}
