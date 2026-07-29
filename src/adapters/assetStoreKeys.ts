import crypto from 'node:crypto'
import { createAssetKey, previewKey, trashKey } from '../core/assetKeys'
import { finalizeCloudUpload } from './finalizeCloudUpload'

export abstract class AssetStoreKeys {
  abstract remove(relativePath: string): Promise<void>
  abstract stat(relativePath: string): Promise<{ size: number } | undefined>
  abstract writeStream(relativePath: string, stream: ReadableStream, size: number): Promise<unknown>

  async finalizeUpload(stagedPath: string, relativePath: string) {
    await finalizeCloudUpload(
      stagedPath,
      relativePath,
      () => this.stat(relativePath),
      (stream, size) => this.writeStream(relativePath, stream, size),
    )
  }

  createPath(requestId: string, originalFileName: string) {
    return createAssetKey(requestId, originalFileName)
  }

  previewPath(originalRelativePath: string) {
    return previewKey(originalRelativePath)
  }

  trashPath(operationId: string, relativePath: string) {
    return trashKey(operationId, relativePath)
  }

  protected temporaryTrashPath(relativePath: string) {
    const fileName = relativePath.split('/').pop() ?? relativePath
    return `.stlquest/trash/${crypto.randomUUID()}__${fileName}`
  }

  async purgeTrash(trashPath: string) {
    await this.remove(trashPath)
  }
}
