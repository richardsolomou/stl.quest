import type { AssetStore } from '../../core/types'
import { stableModelPathsMigration } from './0001StableModelPaths'
import { flatGeneratedAssetPathsMigration } from './0002FlatGeneratedAssetPaths'
import type { AssetMigration, AssetMigrationRepository } from './types'

export const assetMigrations: readonly AssetMigration[] = [stableModelPathsMigration, flatGeneratedAssetPathsMigration]

export async function pendingAssetMigrations(repository: AssetMigrationRepository) {
  const applied = await appliedMigrations(repository)
  return assetMigrations.some((migration) => !applied.has(migration.id))
}

export async function runAssetMigrations(
  repository: AssetMigrationRepository,
  assets: AssetStore,
  migrations: readonly AssetMigration[] = assetMigrations,
) {
  validateRegistry(migrations)
  const applied = await appliedMigrations(repository)
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue
    await migration.run(repository, assets)
    applied.add(migration.id)
    await repository.recordAssetMigration(migration.id)
  }
}

function validateRegistry(migrations: readonly AssetMigration[]) {
  const ids = migrations.map((migration) => migration.id)
  if (ids.some((id) => !/^\d{4}_[a-z0-9_]+$/.test(id))) throw new Error('asset migration ids must use the 0001_name format')
  if (new Set(ids).size !== ids.length) throw new Error('asset migration ids must be unique')
  if (ids.some((id, index) => index > 0 && id <= ids[index - 1])) throw new Error('asset migrations must be appended in order')
}

async function appliedMigrations(repository: AssetMigrationRepository) {
  return new Set(await repository.listAssetMigrations())
}
