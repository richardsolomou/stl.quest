import { createAssetKey } from '../../core/assetKeys'
import { logger } from '../logger'
import type { AssetMigration, AssetMigrationRequest } from './types'

const LEGACY_MODEL_DIRECTORIES = ['todo', 'up-next', 'in-progress', 'post-processing', 'done']

export const stableModelPathsMigration: AssetMigration = {
  id: '0001_stable_model_paths',
  async run(repository, assets) {
    let migrated = 0
    for (const request of await repository.listRequests()) {
      const destinationPath = stablePath(request)
      if (request.filePath === destinationPath) continue
      await assets.ensureMoved(request.filePath, destinationPath)
      if (!(await repository.updateRequestFilePath(request.id, request.filePath, destinationPath))) {
        const current = await repository.getRequest(request.id)
        if (current?.filePath !== destinationPath) throw new Error(`request asset path changed during migration: ${request.id}`)
      }
      migrated++
    }

    for (const directory of LEGACY_MODEL_DIRECTORIES) await assets.removeEmptyDirectory(directory)
    logger.info({ migrated, migrationId: stableModelPathsMigration.id }, 'asset migration completed')
  },
}

function stablePath(request: AssetMigrationRequest) {
  return createAssetKey(request.id, request.fileName)
}
