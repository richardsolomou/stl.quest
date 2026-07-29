import { describe, expect, it, vi } from 'vitest'
import { verifyWritableAssetStore } from './writableAssetStore'

describe('verifyWritableAssetStore', () => {
  it('writes, reads, and removes a probe', async () => {
    const cancel = vi.fn(async () => undefined)
    const write = vi.fn(async () => undefined)
    const read = vi.fn(async () => ({ stream: { cancel } as unknown as ReadableStream }))
    const remove = vi.fn(async () => undefined)
    await verifyWritableAssetStore({ write, read, remove })
    expect(write).toHaveBeenCalledWith(expect.any(String), new Uint8Array([1]))
    expect(cancel).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
  })
})
