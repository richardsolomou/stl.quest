import path from 'node:path'
import type { AssetStore, StorageConfig } from '../core/types'
import type { DrizzleRepository } from '../db/repository'
import { filesystemCapacity } from '../adapters/filesystemCapacity'

export { assertUploadCapacity, filesystemCapacity } from '../adapters/filesystemCapacity'

export async function diagnostics(repository: DrizzleRepository, storage: StorageConfig, assets: AssetStore) {
  const system = await systemDiagnostics(repository)
  let storageCapacity: Awaited<ReturnType<typeof filesystemCapacity>> | undefined
  if (storage.adapter === 'local') storageCapacity = await filesystemCapacity(storage.root)
  await assets.writable()
  return { ...system, storageCapacity }
}

export async function systemDiagnostics(repository: DrizzleRepository) {
  const database = await repository.databaseInfo()
  const dataCapacity =
    database.location.kind === 'local' && database.location.path !== ':memory:'
      ? await filesystemCapacity(path.dirname(database.location.path))
      : undefined
  return { database, dataCapacity }
}
