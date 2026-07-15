import fs from 'node:fs'
import path from 'node:path'
import { FileStore } from '@tus/file-store'
import type { UploadStore } from '../core/types'

export const UPLOAD_TTL = 86_400_000

export class TusUploadStore implements UploadStore {
  readonly datastore: FileStore

  constructor(dataRoot = process.env.DATA_DIR ?? '/data') {
    this.datastore = new FileStore({
      directory: path.join(path.resolve(dataRoot), 'tus'),
      expirationPeriodInMilliseconds: UPLOAD_TTL,
    })
  }

  async remove(uploadId: string) {
    if (!/^[a-z0-9-]{10,64}$/i.test(uploadId)) throw new Error('invalid upload id')
    const filePath = path.join(this.datastore.directory, uploadId)
    await Promise.all([fs.promises.rm(filePath, { force: true }), this.datastore.configstore.delete(uploadId)])
  }
}
