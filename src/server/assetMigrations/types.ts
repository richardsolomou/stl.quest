import type { AssetStore, PrintRequest, Repository } from '../../core/types'

export type AssetMigrationRepository = Pick<
  Repository,
  'completeAssetGeneration' | 'getRequest' | 'listAssetMigrations' | 'listRequests' | 'recordAssetMigration' | 'updateRequestFilePath'
>

export type AssetMigration = {
  id: string
  run(repository: AssetMigrationRepository, assets: AssetStore): Promise<void>
}

export type AssetMigrationRequest = Pick<PrintRequest, 'fileName' | 'id'>
