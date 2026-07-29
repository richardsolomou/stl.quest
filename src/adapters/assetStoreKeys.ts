import { createAssetKey, previewKey, trashKey } from '../core/assetKeys'

export abstract class AssetStoreKeys {
  abstract remove(relativePath: string): Promise<void>

  createPath(requestId: string, originalFileName: string) {
    return createAssetKey(requestId, originalFileName)
  }

  previewPath(originalRelativePath: string) {
    return previewKey(originalRelativePath)
  }

  trashPath(operationId: string, relativePath: string) {
    return trashKey(operationId, relativePath)
  }

  async purgeTrash(trashPath: string) {
    await this.remove(trashPath)
  }
}
