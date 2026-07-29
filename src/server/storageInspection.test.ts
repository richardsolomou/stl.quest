import { describe, expect, it } from 'vitest'
import type { AssetStore } from '../core/types'
import { inspectStorageCandidate, maskStorage } from './storageInspection'

describe('storage inspection', () => {
  it('masks WebDAV passwords', async () => {
    await expect(
      maskStorage({ adapter: 'webdav', endpoint: 'https://storage.example.com', root: 'models', username: 'user', password: 'secret' }),
    ).resolves.toMatchObject({ password: '' })
  })

  it('masks S3 secret keys', async () => {
    await expect(
      maskStorage({
        adapter: 's3',
        endpoint: 'https://s3.example.com',
        region: 'us-east-1',
        bucket: 'models',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        forcePathStyle: false,
      }),
    ).resolves.toMatchObject({ secretAccessKey: '' })
  })

  it('treats a missing optional destination as empty', async () => {
    const candidate = { inventory: async () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })) } as AssetStore

    await expect(inspectStorageCandidate(candidate, true)).resolves.toEqual({
      files: 0,
      folders: 0,
      bytes: 0,
      entries: [],
      truncated: false,
    })
  })

  it('reports inventory failures as client errors', async () => {
    const candidate = { inventory: async () => Promise.reject(new Error('denied')) } as AssetStore

    await expect(inspectStorageCandidate(candidate)).rejects.toMatchObject({ status: 400 })
  })
})
