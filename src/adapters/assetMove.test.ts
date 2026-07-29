import { describe, expect, it, vi } from 'vitest'
import { prepareAssetMove } from './assetMove'

const size = (asset: { size: number }) => asset.size

describe('prepareAssetMove', () => {
  it('recognizes an already completed move', async () => {
    const inspect = vi.fn(async (path: string) => (path === 'destination' ? { size: 4 } : undefined))
    await expect(prepareAssetMove('source', 'destination', inspect, size)).resolves.toBeUndefined()
  })

  it('returns matching source and destination assets for source cleanup', async () => {
    const inspect = vi.fn(async () => ({ size: 4 }))
    await expect(prepareAssetMove('source', 'destination', inspect, size)).resolves.toEqual({
      source: { size: 4 },
      destination: { size: 4 },
    })
  })

  it('rejects conflicting destinations', async () => {
    const inspect = vi.fn(async (path: string) => ({ size: path === 'source' ? 4 : 5 }))
    await expect(prepareAssetMove('source', 'destination', inspect, size)).rejects.toThrow('asset destination already exists: destination')
  })
})
