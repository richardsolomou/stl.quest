import path from 'node:path'
import type { AssetStore, StorageConfig } from '../core/types'
import type { DrizzleRepository } from '../db/repository'
import { filesystemCapacity } from '../adapters/filesystemCapacity'
import { errorMessage } from '../core/error'

export { assertUploadCapacity, filesystemCapacity } from '../adapters/filesystemCapacity'

export async function diagnostics(repository: DrizzleRepository, storage: StorageConfig, assets: AssetStore) {
  const system = await systemDiagnostics(repository)
  let storageCapacity: Awaited<ReturnType<typeof filesystemCapacity>> | undefined
  try {
    if (storage.adapter === 'local') storageCapacity = await filesystemCapacity(storage.root)
    await assets.writable()
    return { ...system, storageCapacity, storageReady: true, storageError: undefined }
  } catch (error) {
    return { ...system, storageCapacity, storageReady: false, storageError: errorMessage(error, 'storage is unavailable') }
  }
}

export async function systemDiagnostics(repository: DrizzleRepository) {
  const database = await repository.databaseInfo()
  const dataCapacity =
    database.location.kind === 'local' && database.location.path !== ':memory:'
      ? await filesystemCapacity(path.dirname(database.location.path))
      : undefined
  return { database, dataCapacity }
}
