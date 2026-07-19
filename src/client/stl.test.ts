import { describe, expect, it } from 'vitest'
import { encodePreviewMesh } from '../core/mesh/previewMesh'
import { parseStl } from './stl'

describe('client STL parser', () => {
  it('loads compressed previews with renderable face normals', async () => {
    const preview = await encodePreviewMesh(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), new Uint32Array([0, 1, 2]))
    const geometry = await parseStl(preview.buffer as ArrayBuffer)
    expect({ positions: geometry.getAttribute('position').count, normals: geometry.getAttribute('normal').count }).toEqual({
      positions: 3,
      normals: 3,
    })
    geometry.dispose()
  })
})
