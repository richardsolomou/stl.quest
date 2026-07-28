import type { StorageConfig } from '../core/types'
import { hostedDeployment } from './hosted'
import { managedStorageAvailable } from './managedStorage'

type SettingsReader = { getSetting(key: string): Promise<unknown> }
export type DeploymentSettingsReader = { getDeploymentSetting(key: string): Promise<unknown> }

export async function localStorageEnabled(repository: DeploymentSettingsReader) {
  if (process.env.STLQUEST_DISTRIBUTED?.trim() === 'true') return false
  const configured = await repository.getDeploymentSetting('local-storage-enabled')
  return typeof configured === 'boolean' ? configured : !hostedDeployment()
}

export async function hostedStorageRequiresRemote(config: StorageConfig, repository: DeploymentSettingsReader) {
  return config.adapter === 'local' && !(await localStorageEnabled(repository))
}

export async function storageConfigured(repository: SettingsReader) {
  return (await repository.getSetting('storageEncrypted')) !== undefined || (await repository.getSetting('storage')) !== undefined
}

export async function assertStorageAllowed(config: StorageConfig, repository: DeploymentSettingsReader) {
  if (config.adapter === 'managed' && (!hostedDeployment() || !managedStorageAvailable()))
    throw new Response('managed storage is not available on this deployment', { status: 403 })
  if (await hostedStorageRequiresRemote(config, repository))
    throw new Response('local storage is disabled by the deployment administrator', { status: 403 })
  if (hostedDeployment() && config.adapter === 'webdav' && new URL(config.endpoint).protocol !== 'https:')
    throw new Response('hosted WebDAV storage must use HTTPS', { status: 400 })
}
