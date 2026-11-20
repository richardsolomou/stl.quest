import { describe, expect, it } from 'vitest'
import { decodePreviewMesh, encodePreviewMesh } from './previewMesh'

describe('preview mesh format', () => {
  it('round-trips indexed triangle positions within the quantization precision', async () => {
    const positions = new Float32Array([-20, 4, 3, 10, -8, 5, 2, 12, -6])
    const encoded = await encodePreviewMesh(positions, new Uint32Array([0, 1, 2, 0, 2, 1]))
    const decoded = (await decodePreviewMesh(encoded))!
    expect(encoded.subarray(0, 4)).toEqual(new TextEncoder().encode('PHM2'))
    expect(Array.from(decoded)).toEqual(
      [...positions, ...positions.subarray(0, 3), ...positions.subarray(6, 9), ...positions.subarray(3, 6)].map((value) =>
        expect.closeTo(value, 3),
      ),
    )
  })

  it('compresses repeated indexed geometry', async () => {
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0])
    const indices = new Uint32Array(30_000).map((_, index) => index % 3)
    expect((await encodePreviewMesh(positions, indices)).byteLength).toBeLessThan(25_000)
  })

  it('rejects a vertex count larger than the indexed corners', async () => {
    const encoded = await encodePreviewMesh(new Float32Array(9), new Uint32Array([0, 1, 2]))
    new DataView(encoded.buffer as ArrayBuffer).setUint32(8, 4, true)
    await expect(decodePreviewMesh(encoded)).rejects.toThrow('preview exceeds the geometry budget')
  })

  it('ignores STL data', async () => {
    expect(await decodePreviewMesh(new Uint8Array(84))).toBeUndefined()
  })
})
