import type { Repository, StorageConfig } from '../core/types'
import { hostedDeployment } from './hosted'

type SettingsReader = { getSetting(key: string): Promise<unknown> }

export async function localStorageAllowed(repository: Pick<Repository, 'isSuperAdminWorkspace'>) {
  return !hostedDeployment() || (await repository.isSuperAdminWorkspace())
}

export async function hostedStorageRequiresRemote(config: StorageConfig, repository: Pick<Repository, 'isSuperAdminWorkspace'>) {
  return config.adapter === 'local' && !(await localStorageAllowed(repository))
}

export async function storageConfigured(repository: SettingsReader) {
  return (await repository.getSetting('storageEncrypted')) !== undefined || (await repository.getSetting('storage')) !== undefined
}

export async function assertStorageAllowed(config: StorageConfig, repository: Pick<Repository, 'isSuperAdminWorkspace'>) {
  if (await hostedStorageRequiresRemote(config, repository))
    throw new Response('local storage is limited to super admin workspaces', { status: 403 })
  if (hostedDeployment() && config.adapter === 'webdav' && new URL(config.endpoint).protocol !== 'https:')
    throw new Response('hosted WebDAV storage must use HTTPS', { status: 400 })
}
