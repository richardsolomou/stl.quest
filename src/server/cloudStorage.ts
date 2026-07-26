import { CLOUD_STORAGE_PROVIDERS } from '../core/auth'
import type {
  CloudStorageApp,
  CloudStorageConnection,
  CloudStorageProvider,
  IntegrationConfig,
  PendingCloudAuthorization,
  WorkspaceCloudStorage,
} from '../core/auth'
import type { DrizzleRepository } from '../db/repository'
import { deploymentSettings, resolveStorageConfig } from './app'
import { decryptSetting, encryptSetting, getStoredIntegrationConfig, setStoredIntegrationConfig, type SettingStore } from './integrations'
import type { EncryptedSetting } from './integrations'
import { logger } from './logger'

export const CLOUD_STORAGE_SETTING = 'cloudStorageEncrypted'

const APP_KEYS = { dropbox: 'dropbox', 'google-drive': 'googleDrive', onedrive: 'oneDrive' } as const satisfies Record<
  CloudStorageProvider,
  keyof IntegrationConfig
>

export function isCloudStorageProvider(adapter: string): adapter is CloudStorageProvider {
  return (CLOUD_STORAGE_PROVIDERS as readonly string[]).includes(adapter)
}

export function cloudProviderName(provider: CloudStorageProvider) {
  return provider === 'dropbox' ? 'Dropbox' : provider === 'google-drive' ? 'Google Drive' : 'OneDrive'
}

export async function cloudStorageApp(deployment: SettingStore, provider: CloudStorageProvider) {
  const app = (await getStoredIntegrationConfig(deployment))?.[APP_KEYS[provider]]
  return app?.clientId && app.clientSecret ? app : undefined
}

export async function requireCloudStorageApp(deployment: SettingStore, provider: CloudStorageProvider) {
  const app = await cloudStorageApp(deployment, provider)
  if (!app) throw new Response(`${cloudProviderName(provider)} is not set up for this deployment`, { status: 409 })
  return app
}

export async function setCloudStorageApp(deployment: SettingStore, provider: CloudStorageProvider, app: CloudStorageApp | undefined) {
  const config = (await getStoredIntegrationConfig(deployment)) ?? { passwordEnabled: true }
  await setStoredIntegrationConfig(deployment, { ...config, [APP_KEYS[provider]]: app })
}

export async function workspaceCloudStorage(workspace: SettingStore): Promise<WorkspaceCloudStorage> {
  const setting = await workspace.getSetting<EncryptedSetting>(CLOUD_STORAGE_SETTING)
  return setting ? decryptSetting<WorkspaceCloudStorage>(setting) : {}
}

export async function cloudStorageConnection(workspace: SettingStore, provider: CloudStorageProvider) {
  return (await workspaceCloudStorage(workspace)).connections?.[provider]
}

export async function setCloudStorageConnection(
  workspace: SettingStore,
  provider: CloudStorageProvider,
  connection: CloudStorageConnection | undefined,
) {
  const current = await workspaceCloudStorage(workspace)
  const connections = { ...current.connections, [provider]: connection }
  if (!connection) delete connections[provider]
  await writeWorkspaceCloudStorage(workspace, { ...current, connections })
}

export async function rotateCloudRefreshToken(workspace: SettingStore, provider: CloudStorageProvider, refreshToken: string) {
  const connection = await cloudStorageConnection(workspace, provider)
  if (!connection) return
  await setCloudStorageConnection(workspace, provider, { ...connection, refreshToken })
}

export async function setPendingCloudAuthorization(workspace: SettingStore, pending: PendingCloudAuthorization | undefined) {
  const current = await workspaceCloudStorage(workspace)
  await writeWorkspaceCloudStorage(workspace, { ...current, pending })
}

async function writeWorkspaceCloudStorage(workspace: SettingStore, value: WorkspaceCloudStorage) {
  await workspace.setSetting(CLOUD_STORAGE_SETTING, encryptSetting(value))
}

// A deployment-wide connection used to serve every workspace. Hand the account to the workspaces that were relying on it.
export async function adoptDeploymentCloudConnections(repository: DrizzleRepository) {
  const deployment = deploymentSettings(repository)
  const stored = await getStoredIntegrationConfig(deployment)
  if (!stored) return
  const legacy = CLOUD_STORAGE_PROVIDERS.map((provider) => ({ provider, connection: legacyConnection(stored, provider) })).filter(
    (entry) => entry.connection,
  )
  if (!legacy.length) return
  for (const workspace of await repository.listWorkspaces()) {
    const scoped = await repository.scoped(workspace.id)
    const adapter = (await resolveStorageConfig(scoped)).adapter
    const adopted = legacy.find((entry) => entry.provider === adapter)
    if (!adopted?.connection || (await cloudStorageConnection(scoped, adopted.provider))) continue
    await setCloudStorageConnection(scoped, adopted.provider, adopted.connection)
    logger.info(
      { event: 'cloud_connection_adopted', provider: adopted.provider, workspaceId: workspace.id },
      'workspace adopted the deployment cloud connection',
    )
  }
  let config = await getStoredIntegrationConfig(deployment)
  for (const { provider } of legacy) {
    const app = config?.[APP_KEYS[provider]]
    config = { ...config!, [APP_KEYS[provider]]: app && { clientId: app.clientId, clientSecret: app.clientSecret } }
  }
  await setStoredIntegrationConfig(deployment, config!)
}

// Records written before app credentials and accounts were separated carry both in the deployment entry.
function legacyConnection(stored: IntegrationConfig, provider: CloudStorageProvider): CloudStorageConnection | undefined {
  const app: (CloudStorageApp & Partial<CloudStorageConnection>) | undefined = stored[APP_KEYS[provider]]
  if (!app?.refreshToken) return undefined
  return {
    refreshToken: app.refreshToken,
    accountId: app.accountId,
    accountName: app.accountName,
    accountEmail: app.accountEmail,
    connectedAt: app.connectedAt,
  }
}
