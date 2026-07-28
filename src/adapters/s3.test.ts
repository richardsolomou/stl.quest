import { S3Client } from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { S3AssetStore } from './s3'

const config = {
  adapter: 's3' as const,
  endpoint: 'https://objects.example.com',
  region: 'us-east-1',
  bucket: 'prints',
  accessKeyId: 'test',
  secretAccessKey: 'test',
  forcePathStyle: true,
}

describe('S3 retries', () => {
  afterEach(() => vi.restoreAllMocks())

  it('retries transient failures', async () => {
    const send = vi
      .spyOn(S3Client.prototype, 'send')
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { $metadata: { httpStatusCode: 503 } }))
      .mockResolvedValueOnce({} as never)

    await new S3AssetStore(config).write('todo/model.stl', new Uint8Array([1]))

    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not retry permanent failures', async () => {
    const send = vi
      .spyOn(S3Client.prototype, 'send')
      .mockRejectedValue(Object.assign(new Error('forbidden'), { $metadata: { httpStatusCode: 403 } }))

    await expect(new S3AssetStore(config).write('todo/model.stl', new Uint8Array([1]))).rejects.toThrow('forbidden')

    expect(send).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['models/model.stl', 'model/stl'],
    ['.stlquest/thumbnails/model.png', 'image/png'],
    ['.stlquest/previews/model.phm', 'application/x-stlquest-preview'],
  ])('stores %s with its media type', async (relativePath, contentType) => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never)

    await new S3AssetStore(config).write(relativePath, new Uint8Array([1]))

    expect(send.mock.calls[0][0].input).toMatchObject({ ContentType: contentType })
  })

  it('deletes objects in S3 batches', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command) => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        const listCalls = send.mock.calls.filter(([candidate]) => candidate.constructor.name === 'ListObjectsV2Command').length
        return (listCalls === 1 ? { Contents: [{ Key: 'first' }, { Key: 'second' }] } : { Contents: [] }) as never
      }
      return {} as never
    })

    await new S3AssetStore(config).clear()

    const deletion = send.mock.calls.find(([command]) => command.constructor.name === 'DeleteObjectsCommand')?.[0]
    expect(deletion?.input).toMatchObject({ Delete: { Objects: [{ Key: 'first' }, { Key: 'second' }], Quiet: true } })
  })

  it('fails cleanup when S3 reports an object deletion error', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command) => {
      if (command.constructor.name === 'ListObjectsV2Command') return { Contents: [{ Key: 'blocked' }] } as never
      return { Errors: [{ Key: 'blocked', Code: 'AccessDenied' }] } as never
    })

    await expect(new S3AssetStore(config).clear()).rejects.toThrow('could not delete 1 object')
  })
})
