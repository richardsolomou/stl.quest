import { describe, expect, it } from 'vitest'
import { resolveAssetQueueLimits } from './queue'

describe('asset queue limits', () => {
  it('uses conservative defaults', () => {
    expect(resolveAssetQueueLimits({})).toEqual({ concurrency: 8, sourceByteBudget: 4096 * 1024 * 1024 })
  })

  it('resolves per-replica worker limits', () => {
    expect(resolveAssetQueueLimits({ ASSET_WORKER_CONCURRENCY: '3', ASSET_WORKER_MEMORY_MB: '768' })).toEqual({
      concurrency: 3,
      sourceByteBudget: 768 * 1024 * 1024,
    })
  })

  it.each(['0', '-1', '1.5', 'invalid'])('rejects an invalid worker limit', (value) => {
    expect(() => resolveAssetQueueLimits({ ASSET_WORKER_CONCURRENCY: value })).toThrow(
      'ASSET_WORKER_CONCURRENCY must be a positive integer',
    )
  })
})
