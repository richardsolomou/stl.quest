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

  it('ignores legacy STL data', async () => {
    expect(await decodePreviewMesh(new Uint8Array(84))).toBeUndefined()
  })

  it('reads first-generation quantized previews during regeneration', async () => {
    const legacy = new Uint8Array(50)
    const view = new DataView(legacy.buffer)
    view.setUint32(0, 0x50484d31)
    view.setUint32(4, 1, true)
    ;[0, 0, 0, 10, 10, 10].forEach((value, axis) => view.setFloat32(8 + axis * 4, value, true))
    ;[0, 0, 0, 65_535, 0, 0, 0, 65_535, 0].forEach((value, index) => view.setUint16(32 + index * 2, value, true))
    expect(Array.from((await decodePreviewMesh(legacy))!)).toEqual([0, 0, 0, 10, 0, 0, 0, 10, 0])
  })
})
