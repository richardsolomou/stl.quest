import { assertPublicEndpoint } from '../adapters/outbound'
import { errorMessage } from '../core/error'
import type { StorageConfig } from '../core/types'
import { hostedDeployment } from './hosted'
import { managedStorageAvailable } from './managedStorage'

type SettingsReader = { getSetting(key: string): Promise<unknown> }

export function localStorageEnabled() {
  return !hostedDeployment() && process.env.STLQUEST_DISTRIBUTED?.trim() !== 'true'
}

export function hostedStorageRequiresRemote(config: StorageConfig) {
  return config.adapter === 'local' && !localStorageEnabled()
}

export async function storageConfigured(repository: SettingsReader) {
  return (await repository.getSetting('storageEncrypted')) !== undefined || (await repository.getSetting('storage')) !== undefined
}

export async function assertStorageAllowed(config: StorageConfig) {
  if (config.adapter === 'managed' && (!hostedDeployment() || !managedStorageAvailable()))
    throw new Response('managed storage is not available on this deployment', { status: 403 })
  if (hostedStorageRequiresRemote(config)) throw new Response('local storage is unavailable in this deployment mode', { status: 403 })
  if (hostedDeployment() && config.adapter === 'webdav' && new URL(config.endpoint).protocol !== 'https:')
    throw new Response('hosted WebDAV storage must use HTTPS', { status: 400 })
  if (hostedDeployment() && (config.adapter === 'webdav' || config.adapter === 's3') && config.endpoint) {
    try {
      assertPublicEndpoint(config.endpoint)
    } catch (error) {
      throw new Response(`storage endpoint ${errorMessage(error, 'is not allowed')}`, { status: 400 })
    }
  }
}
