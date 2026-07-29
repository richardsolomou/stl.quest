import { describe, expect, it, vi } from 'vitest'
import { moveIgnoringMissingSource, prepareAssetMove } from './assetMove'

const size = (asset: { size: number }) => asset.size
const isHttpNotFound = (error: unknown) => (error as { status?: number }).status === 404

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

describe('moveIgnoringMissingSource', () => {
  it('treats a source that vanished mid-move as an already-completed move', async () => {
    const move = vi.fn(async () => {
      throw Object.assign(new Error('File not found'), { status: 404 })
    })
    await expect(moveIgnoringMissingSource(move, isHttpNotFound)).resolves.toBeUndefined()
    expect(move).toHaveBeenCalledOnce()
  })

  it('rethrows move failures that are not a missing source', async () => {
    const move = vi.fn(async () => {
      throw Object.assign(new Error('server error'), { status: 500 })
    })
    await expect(moveIgnoringMissingSource(move, isHttpNotFound)).rejects.toThrow('server error')
  })
})
