import { describe, expect, it } from 'vitest'
import { encodePreviewMesh } from '../core/mesh/previewMesh'
import { analyzePlateGeometry } from './plateGeometry'

describe('plate geometry', () => {
  it('loads compressed previews with centered positions and face normals', async () => {
    const preview = await encodePreviewMesh(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), new Uint32Array([0, 1, 2]))

    const geometry = await analyzePlateGeometry(preview)

    expect({ positions: [...geometry.positions], normals: [...geometry.normals] }).toEqual({
      positions: [-5, -5, 0, 5, -5, 0, -5, 5, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    })
  })
})
