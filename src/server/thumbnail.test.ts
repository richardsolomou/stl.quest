import { expect, it, vi } from 'vitest'
import type { AssetStore } from '../core/types'
import { createThumbnailReader } from './thumbnail'

it('retries a transient thumbnail read failure', async () => {
  const { assets, readAsset } = assetStore()
  readAsset
    .mockRejectedValueOnce(Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }))
    .mockResolvedValueOnce(asset('thumbnail'))
  const read = createThumbnailReader({ retryDelays: [0] })

  const result = await read(assets, 'thumbnails/model.png')

  expect(result.status === 'ready' ? new TextDecoder().decode(result.bytes) : result.status).toBe('thumbnail')
})

it('does not retry a missing thumbnail', async () => {
  const { assets, readAsset } = assetStore()
  readAsset.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
  const read = createThumbnailReader({ retryDelays: [0, 0] })

  const result = await read(assets, 'thumbnails/model.png')

  expect(result).toEqual({ status: 'missing' })
})

it('reports an unavailable store after retries are exhausted', async () => {
  const error = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
  const { assets, readAsset } = assetStore()
  readAsset.mockRejectedValue(error)
  const read = createThumbnailReader({ retryDelays: [0, 0] })

  const result = await read(assets, 'thumbnails/model.png')

  expect(result).toEqual({ status: 'unavailable', error })
})

function asset(contents: string) {
  const bytes = new TextEncoder().encode(contents)
  return { stream: new Blob([bytes]).stream(), size: bytes.byteLength }
}

function assetStore() {
  const readAsset = vi.fn<AssetStore['read']>()
  return { assets: { read: readAsset } as unknown as AssetStore, readAsset }
}
