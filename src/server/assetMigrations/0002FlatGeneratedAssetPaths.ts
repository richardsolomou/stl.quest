import { logger } from '../logger'
import type { AssetMigration } from './types'

const LEGACY_PREFIX = '.stlquest/'

export const flatGeneratedAssetPathsMigration: AssetMigration = {
  id: '0002_flat_generated_asset_paths',
  async run(repository, assets) {
    let migrated = 0
    for (const request of await repository.listRequests()) {
      const thumbnailPath = flatPath(request.thumbnailPath)
      const previewPath = flatPath(request.previewPath)
      if (thumbnailPath === request.thumbnailPath && previewPath === request.previewPath) continue
      if (request.thumbnailPath && thumbnailPath) await assets.ensureMoved(request.thumbnailPath, thumbnailPath)
      if (request.previewPath && previewPath) await assets.ensureMoved(request.previewPath, previewPath)
      await repository.completeAssetGeneration(request.id, { thumbnailPath, previewPath })
      migrated++
    }

    for (const directory of ['.stlquest/previews', '.stlquest/thumbnails', '.stlquest/trash', '.stlquest'])
      await assets.removeEmptyDirectory(directory)
    logger.info(
      { event: 'asset_migration_completed', migrated, migration_id: flatGeneratedAssetPathsMigration.id },
      'asset migration completed',
    )
  },
}

function flatPath(path: string | undefined) {
  return path?.startsWith(LEGACY_PREFIX) ? path.slice(LEGACY_PREFIX.length) : path
}
