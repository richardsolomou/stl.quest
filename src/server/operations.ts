import fs from 'node:fs'
import path from 'node:path'
import type { AssetStore, StorageConfig } from '../core/types'
import type { SqliteRepository } from '../adapters/sqlite'

export async function filesystemCapacity(target: string) {
  const stats = await fs.promises.statfs(target, { bigint: true })
  return { totalBytes: Number(stats.blocks * stats.bsize), freeBytes: Number(stats.bavail * stats.bsize) }
}

export async function assertUploadCapacity(stagingPath: string, bytes: number) {
  const { freeBytes } = await filesystemCapacity(path.dirname(stagingPath))
  const reserve = Math.max(256 * 1024 * 1024, Math.ceil(bytes * 0.05))
  if (freeBytes < bytes + reserve) throw new Response('not enough free disk space for this upload', { status: 507 })
}

export async function diagnostics(repository: SqliteRepository, storage: StorageConfig, assets: AssetStore) {
  const system = await systemDiagnostics(repository)
  let storageCapacity: Awaited<ReturnType<typeof filesystemCapacity>> | undefined
  if (storage.adapter === 'local') storageCapacity = await filesystemCapacity(storage.root)
  await assets.writable()
  return { ...system, storageCapacity }
}

export async function systemDiagnostics(repository: SqliteRepository) {
  const database = repository.databaseInfo()
  const dataCapacity = database.path === ':memory:' ? undefined : await filesystemCapacity(path.dirname(database.path))
  return { database, dataCapacity }
}
