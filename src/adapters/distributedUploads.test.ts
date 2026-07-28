import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { S3UploadStaging } from './distributedUploads'

function stagingWith(datastore: Record<string, unknown>) {
  return new S3UploadStaging(datastore as never, {} as never, 'staging')
}

describe('S3 upload staging', () => {
  it('streams a completed upload into final storage before removing it', async () => {
    const calls: string[] = []
    const datastore = {
      getUpload: vi.fn(async () => ({ size: 3, offset: 3 })),
      read: vi.fn(async () => Readable.from([Buffer.from('stl')])),
      remove: vi.fn(async () => calls.push('remove')),
    }
    const assets = {
      stat: vi.fn(async () => undefined),
      writeStream: vi.fn(async () => calls.push('write')),
    }

    await stagingWith(datastore).finalizeUpload('upload-id', 'todo/model.stl', assets as never)

    expect(calls).toEqual(['write', 'remove'])
  })

  it('treats an existing destination as a completed crash-recovery replay', async () => {
    const assets = { stat: vi.fn(async () => ({ size: 3 })) }

    await expect(
      stagingWith({ getUpload: vi.fn(async () => undefined) }).finalizeUpload('upload-id', 'todo/model.stl', assets as never),
    ).resolves.toBeUndefined()
  })

  it('rejects an existing destination with a different size', async () => {
    const datastore = { getUpload: vi.fn(async () => ({ size: 3, offset: 3 })) }
    const assets = { stat: vi.fn(async () => ({ size: 4 })) }

    await expect(stagingWith(datastore).finalizeUpload('upload-id', 'todo/model.stl', assets as never)).rejects.toThrow(
      'upload destination already exists',
    )
  })

  it('preserves the operation when S3 is temporarily unavailable', async () => {
    const outage = new Error('S3 unavailable')
    const datastore = { getUpload: vi.fn(async () => Promise.reject(outage)) }

    await expect(stagingWith(datastore).finalizeUpload('upload-id', 'todo/model.stl', {} as never)).rejects.toBe(outage)
  })
})
