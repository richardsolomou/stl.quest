import crypto from 'node:crypto'
import { createAssetKey, previewKey, STORAGE_SCAFFOLD_FOLDERS, trashKey } from '../core/assetKeys'
import { finalizeCloudUpload } from './finalizeCloudUpload'

export abstract class AssetStoreKeys {
  abstract remove(relativePath: string): Promise<void>
  abstract stat(relativePath: string): Promise<{ size: number } | undefined>
  abstract writeStream(relativePath: string, stream: ReadableStream, size: number): Promise<unknown>
  abstract ensureMoved(sourcePath: string, destinationPath: string): Promise<unknown>

  async finalizeUpload(stagedPath: string, relativePath: string) {
    await finalizeCloudUpload(
      stagedPath,
      relativePath,
      () => this.stat(relativePath),
      (stream, size) => this.writeStream(relativePath, stream, size),
    )
  }

  protected async initializeStorageScaffold(ensureFolder: (folder: string) => Promise<unknown>) {
    for (const folder of STORAGE_SCAFFOLD_FOLDERS) await ensureFolder(folder)
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
    return `trash/${crypto.randomUUID()}__${fileName}`
  }

  async trash(relativePath: string) {
    if (!(await this.stat(relativePath))) return undefined
    const trashPath = this.temporaryTrashPath(relativePath)
    await this.ensureMoved(relativePath, trashPath)
    return trashPath
  }

  async purgeTrash(trashPath: string) {
    await this.remove(trashPath)
  }
}
