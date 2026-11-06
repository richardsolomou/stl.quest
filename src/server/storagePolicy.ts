import { assertPublicEndpoint } from '../adapters/outbound'
import { errorMessage } from '../core/error'
import type { StorageConfig } from '../core/types'
import { hostedDeployment } from './hosted'
import { serverMessages } from './locale'
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
  const errors = serverMessages().storage.errors
  if (config.adapter === 'managed' && (!hostedDeployment() || !managedStorageAvailable()))
    throw new Response(errors.managedUnavailable, { status: 403 })
  if (hostedStorageRequiresRemote(config)) throw new Response(errors.localUnavailable, { status: 403 })
  if (hostedDeployment() && config.adapter === 'webdav' && new URL(config.endpoint).protocol !== 'https:')
    throw new Response(errors.webdavHttps, { status: 400 })
  if (hostedDeployment() && (config.adapter === 'webdav' || config.adapter === 's3') && config.endpoint) {
    try {
      assertPublicEndpoint(config.endpoint)
    } catch (error) {
      const reason = errorMessage(error, undefined)
      throw new Response(reason ? errors.endpointRejected(reason) : errors.endpointNotAllowed, { status: 400 })
    }
  }
}
